import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { planCuts, type AudioSplitter } from './split'

const FRAME_S = 0.05
const QUIET_WINDOW_S = 0.4

interface Probe {
  durationS: number
  bitrate: number
  sink: AudioSampleSink
}

async function probe(blob: Blob): Promise<Probe> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const track = await input.getPrimaryAudioTrack()
  if (!track) throw new Error('No audio track')
  // 录制的 WebM 头里没有时长，computeDuration 会扫描到文件末尾
  const durationS = await input.computeDuration()
  return {
    durationS,
    bitrate: Math.max(16_000, Math.round((blob.size * 8) / Math.max(durationS, 1))),
    sink: new AudioSampleSink(track),
  }
}

/** 在 [from, to] 秒内找最安静的约 0.4 秒，返回其中点 */
async function quietestPoint(sink: AudioSampleSink, from: number, to: number): Promise<number> {
  const energies: { t: number; e: number }[] = []
  for await (const sample of sink.samples(from, to)) {
    const n = sample.numberOfFrames
    const buf = new Float32Array(n)
    sample.copyTo(buf, { planeIndex: 0, format: 'f32-planar' })
    const frame = Math.max(1, Math.round(sample.sampleRate * FRAME_S))
    for (let i = 0; i < n; i += frame) {
      let sum = 0
      const end = Math.min(n, i + frame)
      for (let j = i; j < end; j++) sum += buf[j]! * buf[j]!
      energies.push({ t: sample.timestamp + i / sample.sampleRate, e: sum / (end - i) })
    }
    sample.close()
  }
  if (energies.length === 0) return (from + to) / 2
  const win = Math.round(QUIET_WINDOW_S / FRAME_S)
  let best = { t: energies[0]!.t, e: Infinity }
  for (let i = 0; i + win <= energies.length; i++) {
    let e = 0
    for (let j = i; j < i + win; j++) e += energies[j]!.e
    if (e < best.e) best = { t: energies[i + Math.floor(win / 2)]!.t, e }
  }
  return best.t
}

/**
 * 基于 mediabunny（WebCodecs）的切片实现，只能在浏览器（离屏文档）中运行。
 * 截取时 mediabunny 会重新编码，必须显式指定与原文件相同的码率，否则切片反而更大（ADR 0004）
 */
export function createMediabunnySplitter(): AudioSplitter {
  const probes = new WeakMap<Blob, Promise<Probe>>()
  const probeOnce = (blob: Blob) => {
    let p = probes.get(blob)
    if (!p) probes.set(blob, (p = probe(blob)))
    return p
  }
  return {
    async plan(blob, maxBytes) {
      const { durationS, sink } = await probeOnce(blob)
      return planCuts(blob.size, durationS, maxBytes, (from, to) => quietestPoint(sink, from, to))
    },
    async cut(blob, startS, endS) {
      const { bitrate } = await probeOnce(blob)
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
      const conversion = await Conversion.init({
        input,
        output,
        trim: { start: startS, end: endS },
        video: { discard: true },
        audio: { codec: 'opus', bitrate },
      })
      if (!conversion.isValid) throw new Error('Cannot convert the audio track to Opus')
      await conversion.execute()
      const buffer = output.target.buffer
      if (!buffer) throw new Error('Empty audio piece')
      return {
        blob: new Blob([buffer], { type: 'audio/webm' }),
        mimeType: 'audio/webm;codecs=opus',
      }
    },
  }
}
