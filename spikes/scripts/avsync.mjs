// 离线分析：ffprobe 容器信息 + 按「闪白帧 / 哔声起点」测音画偏移。可单独运行：node scripts/avsync.mjs <file>
import { execFileSync, spawnSync } from 'node:child_process'

const run = (cmd, args) =>
  execFileSync(cmd, args, { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const runStderr = (args) =>
  spawnSync('ffmpeg', args, { maxBuffer: 1 << 28, encoding: 'utf8' }).stderr ?? ''

export function ffprobe(file) {
  const j = JSON.parse(
    run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]),
  )
  return {
    format: j.format.format_name,
    duration: Number(j.format.duration),
    sizeMB: +(Number(j.format.size) / 2 ** 20).toFixed(1),
    streams: j.streams.map((s) => ({
      codec: s.codec_name,
      profile: s.profile,
      size: s.width ? `${s.width}x${s.height}` : undefined,
      fps: s.avg_frame_rate,
      startTime: Number(s.start_time),
      duration: s.duration ? Number(s.duration) : undefined,
    })),
  }
}

/**
 * 解码全文件检查错误（只输出错误行数）。
 * 忽略 null 封装器的「non monotonically increasing dts」：MediaRecorder 输出可变帧率、毫秒时间基，
 * 相邻帧取整后 DTS 相同，只影响再封装时的时间戳，不是解码错误。
 */
export function decodeErrors(file) {
  const err = runStderr(['-v', 'error', '-i', file, '-f', 'null', '-'])
  const lines = err
    .split('\n')
    .filter(Boolean)
    .filter((l) => !l.includes('non monotonically increasing dts'))
  return { count: lines.length, sample: lines.slice(0, 5) }
}

function flashOnsets(file, start, dur) {
  const out = run('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(start),
    '-t',
    String(dur),
    '-copyts',
    '-i',
    file,
    '-an',
    '-vf',
    'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f',
    'null',
    '-',
  ])
  const onsets = []
  let t = null
  let prev = 0
  for (const line of out.split('\n')) {
    const m = line.match(/pts_time:([\d.]+)/)
    if (m) t = Number(m[1])
    const y = line.match(/YAVG=([\d.]+)/)
    if (y) {
      const v = Number(y[1])
      if (v > 128 && prev <= 128) onsets.push(t)
      prev = v
    }
  }
  return onsets
}

function beepOnsets(file, start, dur) {
  const err = runStderr([
    '-ss',
    String(start),
    '-t',
    String(dur),
    '-copyts',
    '-i',
    file,
    '-vn',
    '-af',
    'silencedetect=noise=-30dB:d=0.05',
    '-f',
    'null',
    '-',
  ])
  return [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
}

/** 每个窗口内把闪白起点和最近的哔声起点配对，offset = 音频 - 视频（毫秒，正数表示声音晚于画面） */
export function avSync(file, windows) {
  return windows.map(([start, dur]) => {
    const flashes = flashOnsets(file, start, dur)
    const beeps = beepOnsets(file, start, dur)
    const offsets = flashes
      .map(
        (f) =>
          beeps.reduce((best, b) => (Math.abs(b - f) < Math.abs(best - f) ? b : best), Infinity) -
          f,
      )
      .filter((o) => Math.abs(o) < 0.5)
      .map((o) => Math.round(o * 1000))
    const sorted = [...offsets].sort((a, b) => a - b)
    return {
      window: `${start}s+${dur}s`,
      pairs: offsets.length,
      flashes: flashes.length,
      beeps: beeps.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? null,
      minMs: sorted[0] ?? null,
      maxMs: sorted.at(-1) ?? null,
    }
  })
}

export function beepTimes(file, start, dur) {
  return beepOnsets(file, start, dur)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  const info = ffprobe(file)
  console.log(JSON.stringify(info, null, 2))
  const d = info.duration || 60
  const w = Math.min(30, d)
  if (info.streams.some((s) => s.size)) {
    const windows = [
      [0, w],
      [Math.max(0, d / 2 - w / 2), w],
      [Math.max(0, d - w - 1), w],
    ]
    console.log(JSON.stringify(avSync(file, windows), null, 2))
  } else {
    console.log(JSON.stringify({ firstBeeps: beepTimes(file, 0, 5) }))
  }
}
