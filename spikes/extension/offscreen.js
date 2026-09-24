// 离屏文档：录制、分片校验、从离屏文档直接写用户文件夹、在离屏文档中调用转写接口
// 注意：离屏文档里只有 chrome.runtime 可用，其余状态通过消息与插件页面交换。

import { transcribeWithParaformer } from './lib/dashscope.js'
import { kvGet } from './lib/idb.js'
import { mimeMatrix, Recording } from './lib/recorder.js'
import { assemble, dirAt, listRecordings, readParts, readText } from './lib/opfs.js'

let current

const handlers = {
  async start({ options }) {
    // start() 的初始化是异步的：在等待之前就占住 current，连续点击 / 并发消息不会启动第二路录制
    if (current && ['starting', 'recording', 'stopping'].includes(current.state)) {
      throw new Error(`already ${current.state}`)
    }
    current = new Recording(options)
    current.state = 'starting'
    try {
      return await current.start()
    } catch (e) {
      current.state = 'failed'
      throw e
    }
  },
  stop: () => current?.stop() ?? { state: 'idle' },
  status: () => current?.status() ?? { state: 'idle' },
  mimeMatrix: () => ({ matrix: mimeMatrix(), userAgent: navigator.userAgent }),
  list: () => listRecordings(),

  /** 分片完整性：OPFS 中实际存在的分片数量、大小与录制时记录的是否一致 */
  async verify({ recId }) {
    const meta = JSON.parse(await readText(await dirAt(['recordings', recId]), 'meta.json'))
    const out = {}
    for (const [track, info] of Object.entries(meta.tracks)) {
      const files = await readParts(recId, track)
      const mismatches = files.filter((f, i) => f.size !== info.sizes[i]).map((f) => f.name)
      out[track] = {
        expectedChunks: info.chunks,
        foundChunks: files.length,
        expectedBytes: info.bytes,
        foundBytes: files.reduce((s, f) => s + f.size, 0),
        mismatches,
        ok: files.length === info.chunks && mismatches.length === 0,
      }
    }
    return out
  },

  /** 验证项 1：离屏文档能否直接使用插件网页存进 IndexedDB 的文件夹句柄 */
  async fsaCheck({ write = true } = {}) {
    const handle = await kvGet('dataDir')
    if (!handle) return { handle: false }
    const result = { handle: true, name: handle.name }
    result.queryPermission = await handle.queryPermission({ mode: 'readwrite' })
    if (result.queryPermission === 'granted' && write) {
      try {
        const fh = await handle.getFileHandle('huilu-offscreen-write-test.txt', { create: true })
        const w = await fh.createWritable()
        await w.write(`written from offscreen at ${new Date().toISOString()}\n`)
        await w.close()
        result.write = 'ok'
      } catch (e) {
        result.write = `${e.name}: ${e.message}`
      }
    }
    try {
      // 离屏文档没有用户激活，预期失败；记录具体报错供 ADR 参考
      result.requestPermission = await handle.requestPermission({ mode: 'readwrite' })
    } catch (e) {
      result.requestPermission = `${e.name}: ${e.message}`
    }
    return result
  },

  /** 从离屏文档把 OPFS 分片流式拷贝到用户文件夹，测大文件写入耗时 */
  async fsaExport({ recId }) {
    const handle = await kvGet('dataDir')
    if ((await handle?.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      return { error: 'no permission — 需要在插件网页中重新授权' }
    }
    const meta = JSON.parse(await readText(await dirAt(['recordings', recId]), 'meta.json'))
    const dir = await handle.getDirectoryHandle(recId, { create: true })
    const out = {}
    for (const [track, info] of Object.entries(meta.tracks)) {
      const ext = info.mimeType.includes('mp4') ? 'mp4' : 'webm'
      const blob = await assemble(recId, track, info.mimeType)
      const t = performance.now()
      const w = await (
        await dir.getFileHandle(`${track}.${ext}`, { create: true })
      ).createWritable()
      await blob.stream().pipeTo(w)
      out[track] = { MB: +(blob.size / 2 ** 20).toFixed(1), ms: Math.round(performance.now() - t) }
    }
    return out
  },

  /** 验证项 4：在离屏文档中跑百炼全流程（生产环境转写就在这里执行） */
  async paraformer({ recId, config }) {
    const logs = []
    const blob = await assemble(recId, 'audio', 'audio/webm')
    const r = await transcribeWithParaformer(blob, `${recId}.webm`, {
      ...config,
      log: (step, detail) => logs.push({ step, ...detail }),
    })
    return { ...r, logs }
  },
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.to !== 'offscreen') return
  const handler = handlers[msg.type]
  if (!handler) return
  Promise.resolve()
    .then(() => handler(msg))
    .then(sendResponse, (e) => sendResponse({ error: `${e.name}: ${e.message}` }))
  return true
})
