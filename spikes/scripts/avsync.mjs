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

const probeStderr = (args) => spawnSync('ffprobe', args, { maxBuffer: 1 << 28, encoding: 'utf8' })

/**
 * FFmpeg（本机 8.0.1）的 Opus 解析器（parser，不是解码器）在 WebM 文件末尾刷新时，
 * 会打印一次「Error parsing Opus packet header.」。它与录制数据无关：ffmpeg 自己用 libopus
 * 编码出的 WebM 也会出现；只做解封装（-count_packets，不解码）同样出现；
 * 把同一文件无损转封装成 Ogg（不经过该解析器）后解码无报错、包数不变；
 * GStreamer（matroskademux + libopus）解码同一文件无告警。
 * 因此只有同时满足「每条 Opus 流恰好一次」「只解封装也恰好一次」「每条流解码帧数 = 包数」
 * 时才把它当作工具噪声。
 */
const OPUS_PARSER_EOF = 'Error parsing Opus packet header'

/**
 * 每条流的包数（只解封装）与解码出的帧数。
 * 编码器前置延迟（initial_padding，Opus 的 pre-skip）大于一帧时，解码器会整帧丢弃开头的包
 * （Chrome 的 MP4 里是 3840 = 一个 60ms 包 + 960），这部分不算丢帧。
 */
function streamCounts(file) {
  const entries = 'stream=index,codec_name,initial_padding,nb_read_packets'
  const packets = probeStderr([
    '-v',
    'repeat+error',
    '-count_packets',
    '-show_entries',
    entries,
    '-of',
    'json',
    file,
  ])
  const frames = probeStderr([
    '-v',
    'error',
    '-show_entries',
    'frame=stream_index,nb_samples',
    '-of',
    'csv=p=0',
    file,
  ])
  const decoded = new Map()
  for (const line of frames.stdout.split('\n').filter(Boolean)) {
    const [index, samples] = line.split(',').map(Number)
    const d = decoded.get(index) ?? { frames: 0, maxSamples: 0 }
    d.frames++
    d.maxSamples = Math.max(d.maxSamples, samples || 0)
    decoded.set(index, d)
  }
  return {
    demuxStderr: packets.stderr ?? '',
    streams: JSON.parse(packets.stdout).streams.map((s) => {
      const d = decoded.get(s.index) ?? { frames: 0, maxSamples: 0 }
      const padding = Number(s.initial_padding) || 0
      return {
        index: s.index,
        codec: s.codec_name,
        packets: Number(s.nb_read_packets),
        frames: d.frames,
        preskipFrames: d.maxSamples ? Math.floor(padding / d.maxSamples) : 0,
      }
    }),
  }
}

/**
 * 解码全文件检查错误。count 只计真实错误：解码器 / 解封装报错，或某条流解码帧数少于包数（扣除 pre-skip 整帧）。
 * 忽略 null 封装器的「non monotonically increasing dts」：MediaRecorder 输出可变帧率、毫秒时间基，
 * 相邻帧取整后 DTS 相同，只影响再封装时的时间戳，不是解码错误。
 * Opus 解析器的文件末尾误报见 OPUS_PARSER_EOF，被忽略的行放在 ignored 里，不会静默丢弃。
 */
export function decodeErrors(file) {
  const err = runStderr(['-v', 'repeat+error', '-i', file, '-f', 'null', '-'])
  const lines = err
    .split('\n')
    .filter(Boolean)
    .filter((l) => !l.includes('non monotonically increasing dts'))
  const { demuxStderr, streams } = streamCounts(file)
  const lostFrames = streams.filter((s) => s.frames + s.preskipFrames < s.packets)
  // 末尾误报每条 Opus 流恰好一次；中途有坏包时解析器会多报并直接丢包（解封装的包数也跟着少），
  // 所以用 repeat 日志逐条计数，次数多于 Opus 流数就全部算作错误
  const opusStreams = streams.filter((s) => s.codec === 'opus').length
  const countOpus = (text) => text.split('\n').filter((l) => l.includes(OPUS_PARSER_EOF)).length
  const opusParserNoise =
    opusStreams > 0 &&
    lostFrames.length === 0 &&
    countOpus(err) === opusStreams &&
    countOpus(demuxStderr) === opusStreams
  const ignored = opusParserNoise ? lines.filter((l) => l.includes(OPUS_PARSER_EOF)) : []
  const errors = lines.filter((l) => !ignored.includes(l))
  for (const s of lostFrames) {
    errors.push(`stream ${s.index} (${s.codec}): decoded ${s.frames} of ${s.packets} packets`)
  }
  return { count: errors.length, sample: errors.slice(0, 5), ignored, streams }
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
