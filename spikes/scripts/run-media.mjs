// 验证项 2 + 3 自动化：在离屏文档中录制合成画面（闪白 + 哔声），定时采样内存 / CPU，
// 结束后校验分片、浏览器内播放拖动、mediabunny 解析与转封装，再用 ffmpeg 离线测音画同步。
//
// node scripts/run-media.mjs --minutes 3 --height 1080 [--fps 30] [--mime 'video/mp4;codecs=avc1,opus']
//   [--keyframe-ms 1000] [--mic] [--headed]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { avSync, beepTimes, decodeErrors, ffprobe } from './avsync.mjs'
import { arg, download, launch, processSnapshot, ROOT } from './lib.mjs'

const minutes = Number(arg('minutes', 3))
const height = Number(arg('height', 1080))
const fps = Number(arg('fps', 30))
const id = `auto-${height}p-${minutes}m-${new Date().toISOString().replace(/[:.]/g, '-')}`
const outDir = join(ROOT, 'out', id)
mkdirSync(outDir, { recursive: true })
const report = { id, minutes, height, fps }
const save = () => writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const { context, page, version } = await launch({ headless: !arg('headed') })
report.chrome = version
const off = (type, payload) => page.evaluate(([t, p]) => window.spike.off(t, p), [type, payload])

report.mimeMatrix = (await off('mimeMatrix')).matrix
log('chrome', version)

const options = { id, source: 'synthetic', height, fps, mic: !!arg('mic'), busy: true }
if (arg('mime')) options.videoMime = arg('mime')
if (arg('keyframe-ms')) options.keyFrameIntervalMs = Number(arg('keyframe-ms'))
const started = await off('start', { options })
if (started.error) throw new Error(started.error)
report.tracks = started.tracks
log('recording', JSON.stringify(started.tracks))

// 每分钟采样：离屏文档内的 JS 堆 + 各进程 CPU / 内存
report.samples = []
let prev = { at: Date.now(), procs: processSnapshot() }
const end = Date.now() + minutes * 60_000
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, Math.min(60_000, end - Date.now())))
  const status = await off('status')
  const procs = processSnapshot()
  const dt = (Date.now() - prev.at) / 1000
  const byType = {}
  for (const p of procs) {
    const before = prev.procs.find((q) => q.pid === p.pid)
    const t = (byType[p.type] ??= { cpuPct: 0, rssMB: 0, n: 0 })
    t.cpuPct += before ? ((p.cpuS - before.cpuS) / dt) * 100 : 0
    t.rssMB += p.rssMB
    t.n++
  }
  for (const t of Object.values(byType)) t.cpuPct = Math.round(t.cpuPct)
  const sample = {
    elapsedS: status.elapsedS,
    heapUsedMB: status.last?.heapUsedMB,
    tracks: status.last?.tracks,
    frames: status.last?.frames,
    totalRssMB: procs.reduce((s, p) => s + p.rssMB, 0),
    totalCpuPct: Object.values(byType).reduce((s, t) => s + t.cpuPct, 0),
    byType,
  }
  report.samples.push(sample)
  save()
  log(
    `${sample.elapsedS}s heap=${sample.heapUsedMB}MB rss=${sample.totalRssMB}MB cpu=${sample.totalCpuPct}%`,
    JSON.stringify(sample.tracks),
  )
  if (status.events?.length) log('events', JSON.stringify(status.events.slice(-3)))
  prev = { at: Date.now(), procs }
}

const stopped = await off('stop')
report.events = stopped.events
report.stopStatus = stopped.tracks
log('stopped', JSON.stringify(stopped))

report.verify = await off('verify', { recId: id })
log('verify', JSON.stringify(report.verify))
// 分片完整性是本验证的核心：任何一路校验失败都让命令以非 0 退出（报告照常写完）
const verifyFailed = report.verify?.error || !Object.values(report.verify ?? {}).every((t) => t.ok)
if (verifyFailed || stopped.error || stopped.state !== 'stopped') process.exitCode = 1

report.playback = await page.evaluate(async (recId) => {
  const s = window.spike
  const r = {}
  for (const track of ['video', 'audio']) {
    const blob = await s.trackBlob(recId, track)
    r[track] = {
      MB: +(blob.size / 2 ** 20).toFixed(1),
      playback: await s.playbackCheck(blob).catch((e) => String(e)),
      probe: await s.probe(blob).catch((e) => String(e)),
    }
  }
  // 转封装为普通 MP4，写入 OPFS 后再做一次播放检查
  const root = await navigator.storage.getDirectory()
  const fh = await root.getFileHandle(`${recId}.remux.mp4`, { create: true })
  const t = performance.now()
  try {
    await s.remuxToMp4(await s.trackBlob(recId, 'video'), await fh.createWritable())
    const file = await fh.getFile()
    r.remux = {
      ms: Math.round(performance.now() - t),
      MB: +(file.size / 2 ** 20).toFixed(1),
      playback: await s.playbackCheck(file),
      probe: await s.probe(file),
    }
  } catch (e) {
    r.remux = { error: String(e) }
  }
  return r
}, id)
save()
log('playback', JSON.stringify(report.playback))

// 把原始文件和转封装文件下载出来做 ffmpeg 分析
const files = await download(
  page,
  () =>
    page.evaluate(async (recId) => {
      const s = window.spike
      const root = await navigator.storage.getDirectory()
      const items = [
        [`${recId}-video.mp4`, await s.trackBlob(recId, 'video')],
        [`${recId}-audio.webm`, await s.trackBlob(recId, 'audio')],
      ]
      try {
        items.push([
          `${recId}-remux.mp4`,
          await (await root.getFileHandle(`${recId}.remux.mp4`)).getFile(),
        ])
      } catch {
        /* 转封装失败时没有这个文件 */
      }
      for (const [name, blob] of items) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download =
          blob.type.includes('webm') && name.endsWith('.mp4') ? name.replace(/mp4$/, 'webm') : name
        a.click()
      }
    }, id),
  outDir,
)
await context.close()

report.ffmpeg = {}
for (const file of files) {
  const name = file.split('/').at(-1)
  const info = ffprobe(file)
  const d = info.duration || minutes * 60
  const w = Math.min(30, d)
  const windows = [
    [0, w],
    [Math.max(0, d / 2 - w / 2), w],
    [Math.max(0, d - w - 2), w],
  ].map(([a, b]) => [Math.round(a), Math.round(b)])
  const entry = { info, decodeErrors: minutes <= 10 ? decodeErrors(file) : 'skipped (long file)' }
  if (info.streams.some((s) => s.size)) entry.avSync = avSync(file, windows)
  else entry.firstBeeps = beepTimes(file, 0, 5)
  report.ffmpeg[name] = entry
  log(name, JSON.stringify(entry))
}
save()
log('report →', join(outDir, 'report.json'))
if (process.exitCode)
  log('FAILED: 分片校验未通过或录制未正常结束，见 report.json 中的 verify / events')
