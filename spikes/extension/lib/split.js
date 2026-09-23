// 按静音点切片：在每个理想切点前后的窗口里解码音频，找能量最低的一段作为切点，
// 再用 mediabunny 截取（WebM/Opus 输出）。整段音频不会一次性解码进内存。

import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  WebMOutputFormat,
} from '../vendor/mediabunny.min.mjs'

const FRAME_S = 0.05

/** 在 [from, to] 秒内找最安静的约 0.4 秒，返回其中点 */
async function quietestPoint(sink, from, to) {
  const energies = []
  for await (const sample of sink.samples(from, to)) {
    const n = sample.numberOfFrames
    const buf = new Float32Array(n)
    sample.copyTo(buf, { planeIndex: 0, format: 'f32-planar' })
    const frame = Math.max(1, Math.round(sample.sampleRate * FRAME_S))
    for (let i = 0; i < n; i += frame) {
      let sum = 0
      const end = Math.min(n, i + frame)
      for (let j = i; j < end; j++) sum += buf[j] * buf[j]
      energies.push({ t: sample.timestamp + i / sample.sampleRate, e: sum / (end - i) })
    }
    sample.close()
  }
  if (energies.length === 0) return (from + to) / 2
  const win = Math.round(0.4 / FRAME_S)
  let best = { t: energies[0].t, e: Infinity }
  for (let i = 0; i + win <= energies.length; i++) {
    let e = 0
    for (let j = i; j < i + win; j++) e += energies[j].e
    if (e < best.e) best = { t: energies[i + Math.floor(win / 2)].t, e }
  }
  return best.t
}

/** 截取时 mediabunny 会重新编码，码率必须跟原文件一致，否则切片反而更大 */
async function cut(blob, start, end, bitrate) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start, end },
    audio: { codec: 'opus', bitrate },
  })
  await conversion.execute()
  return new Blob([output.target.buffer], { type: 'audio/webm' })
}

/**
 * 返回 [{ blob, offsetS, ext }]。不超过 maxBytes 时原样返回。
 * 按平均码率估算每片时长（留 10% 余量），切点在理想位置前 searchS 秒内找静音。
 */
export async function splitAudio(blob, { maxBytes, searchS = 20, log } = {}) {
  if (blob.size <= maxBytes) return [{ blob, offsetS: 0, ext: 'webm' }]
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryAudioTrack()
  const duration = await input.computeDuration()
  const sink = new AudioSampleSink(track)
  const pieceS = (duration * (maxBytes * 0.9)) / blob.size
  const bitrate = Math.max(16_000, Math.round((blob.size * 8) / duration))

  const cuts = [0]
  while (duration - cuts.at(-1) > pieceS) {
    const ideal = cuts.at(-1) + pieceS
    cuts.push(await quietestPoint(sink, Math.max(cuts.at(-1) + 1, ideal - searchS), ideal))
  }
  cuts.push(duration)
  log?.('cuts', { duration, pieceS, cuts: cuts.map((c) => +c.toFixed(2)) })

  const pieces = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const piece = await cut(blob, cuts[i], cuts[i + 1], bitrate)
    if (piece.size > maxBytes) throw new Error(`piece ${i} still ${piece.size} bytes`)
    pieces.push({ blob: piece, offsetS: cuts[i], ext: 'webm' })
  }
  return pieces
}
