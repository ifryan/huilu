import { DASHSCOPE_ENDPOINTS, transcribeWithParaformer } from './lib/dashscope.js'
import { kvDel, kvGet, kvSet } from './lib/idb.js'
import { playbackCheck, probe, remuxToMp4 } from './lib/media.js'
import { OPENAI_COMPATIBLE_PRESETS, transcribePieces } from './lib/openai-compatible.js'
import { assemble, listRecordings } from './lib/opfs.js'
import { VIDEO_MIME_CANDIDATES } from './lib/recorder.js'
import { splitAudio } from './lib/split.js'

const $ = (id) => document.getElementById(id)
const show = (el, value) => ($(el).textContent = JSON.stringify(value, null, 2))
const chromeVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1]
$('ua').textContent = `Chrome ${chromeVersion} · ${navigator.platform}`

/** 发给离屏文档（经后台转发，确保离屏文档已创建） */
const off = (type, payload = {}) =>
  chrome.runtime.sendMessage({ to: 'background', type: 'forward', payload: { type, ...payload } })

// ---------- 1. 文件夹授权 ----------

async function fsaRecordLoad(event) {
  const handle = await kvGet('dataDir')
  const entry = {
    at: new Date().toLocaleString(),
    chrome: chromeVersion,
    event,
    handle: handle?.name ?? null,
    permission: handle ? await handle.queryPermission({ mode: 'readwrite' }) : null,
  }
  const history = JSON.parse(localStorage.getItem('fsaHistory') ?? '[]')
  history.push(entry)
  localStorage.setItem('fsaHistory', JSON.stringify(history.slice(-30)))
  $('fsa-history').innerHTML = history
    .slice()
    .reverse()
    .map(
      (h) =>
        `<tr><td>${h.at}</td><td>${h.chrome}</td><td>${h.event}</td><td>${h.handle}</td><td><b>${h.permission}</b></td></tr>`,
    )
    .join('')
  return entry
}

$('fsa-pick').onclick = async () => {
  const handle = await showDirectoryPicker({
    id: 'huilu-data',
    mode: 'readwrite',
    startIn: 'documents',
  })
  await kvSet('dataDir', handle)
  await fsaRecordLoad('picked')
}
$('fsa-request').onclick = async () => {
  const handle = await kvGet('dataDir')
  await handle?.requestPermission({ mode: 'readwrite' })
  await fsaRecordLoad('requested')
}
$('fsa-write').onclick = async () => {
  const handle = await kvGet('dataDir')
  const fh = await handle.getFileHandle('huilu-page-write-test.txt', { create: true })
  const w = await fh.createWritable()
  await w.write(`written from lab page at ${new Date().toISOString()}\n`)
  await w.close()
  await fsaRecordLoad('page-write-ok')
}
$('fsa-offscreen').onclick = async () => show('rec-status', await off('fsaCheck'))
$('fsa-clear').onclick = async () => {
  await kvDel('dataDir')
  await fsaRecordLoad('cleared')
}
fsaRecordLoad('page-load')

// ---------- 2 / 3. 录制 ----------

for (const t of VIDEO_MIME_CANDIDATES) {
  const ok = MediaRecorder.isTypeSupported(t)
  $('opt-mime').insertAdjacentHTML('beforeend', `<option ${ok ? '' : 'disabled'}>${t}</option>`)
}

async function readOptions() {
  const options = {
    height: Number($('opt-height').value),
    fps: Number($('opt-fps').value),
    mic: $('opt-mic').checked,
    videoMime: $('opt-mime').value,
  }
  await chrome.storage.local.set({ spikeOptions: options })
  return options
}

$('mic-grant').onclick = async () => {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true })
  s.getTracks().forEach((t) => t.stop())
  show('rec-status', { mic: 'granted' })
}
$('rec-synthetic').onclick = async () =>
  show(
    'rec-status',
    await off('start', { options: { ...(await readOptions()), source: 'synthetic' } }),
  )
$('rec-stop').onclick = async () => show('rec-status', await off('stop'))
setInterval(async () => {
  const s = await off('status')
  if (s?.state && s.state !== 'idle') show('rec-status', s)
}, 2000)

async function refreshList() {
  const list = await listRecordings()
  $('rec-table').innerHTML = list
    .map(
      (
        r,
      ) => `<tr><td>${r.id}</td><td>${r.meta ? Math.round(r.meta.durationMs / 1000) + 's' : '未完成'}</td>
      <td>${Object.values(r.meta?.tracks ?? {})
        .map((t) => t.mimeType)
        .join('<br>')}</td>
      <td><button data-act="verify" data-id="${r.id}">校验分片</button>
      <button data-act="play" data-id="${r.id}">播放/拖动</button>
      <button data-act="probe" data-id="${r.id}">解析</button>
      <button data-act="export" data-id="${r.id}">导出到文件夹</button>
      <button data-act="remux" data-id="${r.id}">转封装 MP4</button>
      <button data-act="download" data-id="${r.id}">下载</button></td></tr>`,
    )
    .join('')
  $('tr-rec').innerHTML = list.map((r) => `<option>${r.id}</option>`).join('')
}
$('rec-list').onclick = refreshList
refreshList()

const trackBlob = async (recId, track) => {
  const [meta] = (await listRecordings()).filter((r) => r.id === recId).map((r) => r.meta)
  return assemble(recId, track, meta.tracks[track].mimeType)
}

const actions = {
  verify: (id) => off('verify', { recId: id }),
  export: (id) => off('fsaExport', { recId: id }),
  play: async (id) => ({
    video: await playbackCheck(await trackBlob(id, 'video')).catch((e) => String(e)),
    audio: await playbackCheck(await trackBlob(id, 'audio')).catch((e) => String(e)),
  }),
  probe: async (id) => ({
    video: await probe(await trackBlob(id, 'video')).catch((e) => String(e)),
    audio: await probe(await trackBlob(id, 'audio')).catch((e) => String(e)),
  }),
  remux: async (id) => {
    const dir = await kvGet('dataDir')
    const target = await (dir ?? (await navigator.storage.getDirectory())).getFileHandle(
      `${id}.remux.mp4`,
      {
        create: true,
      },
    )
    const t = performance.now()
    await remuxToMp4(await trackBlob(id, 'video'), await target.createWritable())
    const file = await target.getFile()
    return {
      to: dir ? `数据文件夹/${file.name}` : `OPFS/${file.name}`,
      MB: +(file.size / 2 ** 20).toFixed(1),
      ms: Math.round(performance.now() - t),
      playback: await playbackCheck(file),
    }
  },
  download: async (id) => {
    for (const track of ['video', 'audio']) {
      const blob = await trackBlob(id, track).catch(() => null)
      if (!blob) continue
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${id}-${track}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`
      a.click()
    }
    return { downloading: true }
  },
}
$('rec-table').onclick = async (e) => {
  const { act, id } = e.target.dataset
  if (!act) return
  show('rec-status', { [act]: '…' })
  show('rec-status', await actions[act](id).catch((err) => ({ error: String(err) })))
}

// ---------- 4. 转写 ----------

const cfgFields = ['cfg-dashscope', 'cfg-region', 'cfg-ds-model', 'cfg-groq', 'cfg-maxmb']
chrome.storage.local.get('spikeCfg').then(({ spikeCfg = {} }) => {
  for (const f of cfgFields) if (spikeCfg[f] !== undefined) $(f).value = spikeCfg[f]
})
for (const f of cfgFields) {
  $(f).onchange = () =>
    chrome.storage.local.set({
      spikeCfg: Object.fromEntries(cfgFields.map((k) => [k, $(k).value])),
    })
}

const dashscopeConfig = () => ({
  apiKey: $('cfg-dashscope').value,
  baseUrl: DASHSCOPE_ENDPOINTS[$('cfg-region').value],
  model: $('cfg-ds-model').value,
})

async function sourceAudio() {
  const file = $('tr-file').files[0]
  if (file) return { blob: file, name: file.name }
  const id = $('tr-rec').value
  return { blob: await trackBlob(id, 'audio'), name: `${id}.webm`, recId: id }
}

const logs = []
const log = (step, detail) => {
  logs.push({ t: new Date().toLocaleTimeString(), step, ...detail })
  show('tr-out', { logs })
}

const trActions = {
  'tr-paraformer': async () => {
    const { blob, name } = await sourceAudio()
    return transcribeWithParaformer(blob, name, { ...dashscopeConfig(), log })
  },
  'tr-paraformer-off': async () => {
    const { recId } = await sourceAudio()
    if (!recId) throw new Error('离屏文档测试请选择一条录制（不支持本地文件）')
    return off('paraformer', { recId, config: dashscopeConfig() })
  },
  'tr-split': async () => {
    const { blob } = await sourceAudio()
    const pieces = await splitAudio(blob, { maxBytes: Number($('cfg-maxmb').value) * 2 ** 20, log })
    return Promise.all(
      pieces.map(async (p) => ({
        offsetS: +p.offsetS.toFixed(2),
        MB: +(p.blob.size / 2 ** 20).toFixed(2),
        probe: await probe(p.blob),
      })),
    )
  },
  'tr-groq': async () => {
    const { blob } = await sourceAudio()
    const preset = OPENAI_COMPATIBLE_PRESETS.groq
    const maxBytes = Math.min(preset.maxFileBytes, Number($('cfg-maxmb').value) * 2 ** 20)
    const pieces = await splitAudio(blob, { maxBytes, log })
    return transcribePieces(pieces, { ...preset, apiKey: $('cfg-groq').value, log })
  },
}
for (const [id, fn] of Object.entries(trActions)) {
  $(id).onclick = async () => {
    logs.length = 0
    try {
      show('tr-out', { logs, result: await fn() })
    } catch (e) {
      show('tr-out', { logs, error: String(e), body: e.body })
    }
  }
}

// 供自动化脚本（scripts/*.mjs）调用
window.spike = {
  off,
  playbackCheck,
  probe,
  remuxToMp4,
  splitAudio,
  trackBlob,
  listRecordings,
  kvGet,
}
