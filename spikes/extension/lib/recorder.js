// 录制引擎（在离屏文档中运行）：来源 → Web Audio 混音 → 两路 MediaRecorder（视频 + 低码率纯音频）
// → 每 5 秒一个分片写入 OPFS，并定期记录内存 / 分片 / 丢帧统计。

import { dirAt, writeFile } from './opfs.js'

/** 视频轨按顺序尝试：优先 H.264 + AAC（Windows / macOS 支持），其次 H.264 + Opus，最后 WebM */
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4;codecs=avc1.640028,opus',
  'video/mp4;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
]

/** 转写用纯音频轨：WebM/Opus 体积最小，百炼与 Groq 均接受 */
export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=opus',
  'audio/webm',
]

export function pickMime(candidates, preferred) {
  if (preferred && MediaRecorder.isTypeSupported(preferred)) return preferred
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export function mimeMatrix() {
  const all = [
    ...VIDEO_MIME_CANDIDATES,
    'video/mp4',
    'video/mp4;codecs=avc3,mp4a.40.2',
    'video/mp4;codecs=hvc1,mp4a',
    'video/mp4;codecs=av01,opus',
    'video/mp4;codecs=vp9,opus',
    ...AUDIO_MIME_CANDIDATES,
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg;codecs=opus',
  ]
  return Object.fromEntries([...new Set(all)].map((t) => [t, MediaRecorder.isTypeSupported(t)]))
}

const pad = (n) => String(n).padStart(6, '0')

/**
 * 合成来源：画布 + 振荡器。每秒整点同时「闪白 + 1kHz 哔声 100ms」，用于离线检测音画同步。
 * 画面由 Worker 定时驱动（隐藏文档里的 setInterval / rAF 会被节流）。
 */
function syntheticSource(ctx, { width, height, fps, busy }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  const stream = canvas.captureStream(fps)

  const osc = ctx.createOscillator()
  osc.frequency.value = 1000
  const gate = ctx.createGain()
  gate.gain.value = 0
  osc.connect(gate)
  osc.start()
  // 预先排好未来的哔声，每次 tick 补排
  let scheduledUntil = Math.ceil(ctx.currentTime)
  const scheduleBeeps = () => {
    while (scheduledUntil < ctx.currentTime + 5) {
      gate.gain.setValueAtTime(0.5, scheduledUntil)
      gate.gain.setValueAtTime(0, scheduledUntil + 0.1)
      scheduledUntil += 1
    }
  }

  let frame = 0
  const draw = () => {
    scheduleBeeps()
    const t = ctx.currentTime
    const flash = t % 1 < 0.1
    g.fillStyle = flash ? '#fff' : '#101418'
    g.fillRect(0, 0, width, height)
    if (!flash) {
      if (busy) {
        // 模拟屏幕共享里的滚动文字 / 画面变化，给编码器真实负载
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `hsl(${(frame * 3 + i * 37) % 360} 60% 50%)`
          g.fillRect(((frame * 7 + i * 97) % width) | 0, ((i * 53 + frame) % height) | 0, 160, 90)
        }
      }
      g.fillStyle = '#4af'
      g.fillRect((frame * 8) % width, height / 2 - 20, 40, 40)
    }
    g.fillStyle = flash ? '#000' : '#fff'
    g.font = `${Math.round(height / 12)}px monospace`
    g.fillText(`${t.toFixed(2)}s  #${frame}`, 40, height / 6)
    frame++
  }
  const ticker = new Worker('tick-worker.js')
  ticker.onmessage = draw
  ticker.postMessage({ intervalMs: 1000 / fps })

  return {
    videoTrack: stream.getVideoTracks()[0],
    audioNode: gate,
    stop() {
      ticker.terminate()
      osc.stop()
      stream.getTracks().forEach((tr) => tr.stop())
    },
  }
}

async function tabSource(ctx, { streamId, width, height, fps }) {
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: fps,
      },
    },
  })
  const audioNode = ctx.createMediaStreamSource(media)
  // tabCapture 会让标签页静音，需要把声音再播回给用户
  audioNode.connect(ctx.destination)
  return {
    videoTrack: media.getVideoTracks()[0],
    audioNode,
    stop: () => media.getTracks().forEach((tr) => tr.stop()),
  }
}

export class Recording {
  constructor(options) {
    const height = options.height ?? 1080
    this.options = {
      fps: 30,
      width: Math.round((height * 16) / 9),
      height,
      mic: false,
      busy: true,
      timesliceMs: 5000,
      // 不设置时 Chrome 的 MP4 分片间隔可达 11 秒（见 ADR 0004）
      keyFrameIntervalMs: 1000,
      videoBitsPerSecond: height >= 1080 ? 4_000_000 : 2_500_000,
      audioBitsPerSecond: 128_000,
      transcriptAudioBitsPerSecond: 24_000,
      ...options,
    }
    this.id = options.id ?? new Date().toISOString().replace(/[:.]/g, '-')
    this.state = 'idle'
    this.tracks = {}
    this.samples = []
    this.events = []
  }

  log(type, detail) {
    this.events.push({ t: Math.round(performance.now() - (this.t0 ?? 0)), type, ...detail })
  }

  async start() {
    const o = this.options
    this.dir = await dirAt(['recordings', this.id])
    this.ctx = new AudioContext({ latencyHint: 'playback' })
    this.mix = this.ctx.createMediaStreamDestination()

    this.source = o.source === 'tab' ? await tabSource(this.ctx, o) : syntheticSource(this.ctx, o)
    this.source.audioNode.connect(this.mix)

    if (o.mic) {
      try {
        // 离屏文档无法弹出授权框：麦克风权限必须事先在可见的插件页面里授予过
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        this.ctx.createMediaStreamSource(this.micStream).connect(this.mix)
        this.log('mic', { ok: true })
      } catch (e) {
        this.log('mic', { ok: false, error: `${e.name}: ${e.message}` })
      }
    }

    const mixed = this.mix.stream.getAudioTracks()[0]
    this.videoTrack = this.source.videoTrack
    this.videoTrack.addEventListener('ended', () => {
      this.log('video-track-ended')
      this.stop()
    })

    if (o.mode !== 'audio') {
      const mime = pickMime(VIDEO_MIME_CANDIDATES, o.videoMime)
      await this.addTrack('video', new MediaStream([this.videoTrack, mixed]), {
        mimeType: mime,
        videoBitsPerSecond: o.videoBitsPerSecond,
        audioBitsPerSecond: o.audioBitsPerSecond,
        // Chrome 扩展选项：强制关键帧间隔，MP4 只能在关键帧处切分片
        ...(o.keyFrameIntervalMs && { videoKeyFrameIntervalDuration: o.keyFrameIntervalMs }),
      })
    }
    await this.addTrack('audio', new MediaStream([mixed.clone()]), {
      mimeType: pickMime(AUDIO_MIME_CANDIDATES, o.audioMime),
      audioBitsPerSecond: o.transcriptAudioBitsPerSecond,
    })

    this.t0 = performance.now()
    this.startedAt = Date.now()
    for (const tr of Object.values(this.tracks)) tr.recorder.start(o.timesliceMs)
    this.state = 'recording'
    this.sampler = setInterval(() => this.sample(), 10_000)
    this.sample()
    return this.status()
  }

  async addTrack(name, stream, recorderOptions) {
    const dir = await dirAt(['recordings', this.id, name])
    const recorder = new MediaRecorder(stream, recorderOptions)
    const tr = {
      name,
      dir,
      recorder,
      mimeType: recorder.mimeType,
      seq: 0,
      bytes: 0,
      sizes: [],
      lastChunkAt: 0,
      maxGapMs: 0,
      writeQueue: Promise.resolve(),
      pendingWrites: 0,
      maxWriteMs: 0,
      writeErrors: 0,
    }
    recorder.ondataavailable = (e) => this.onChunk(tr, e.data)
    recorder.onerror = (e) => this.log('recorder-error', { track: name, error: String(e.error) })
    tr.stopped = new Promise((resolve) => (recorder.onstop = resolve))
    this.tracks[name] = tr
  }

  onChunk(tr, blob) {
    const now = performance.now()
    if (tr.lastChunkAt) tr.maxGapMs = Math.max(tr.maxGapMs, Math.round(now - tr.lastChunkAt))
    tr.lastChunkAt = now
    if (blob.size === 0) return
    const name = `${pad(++tr.seq)}.part`
    tr.bytes += blob.size
    tr.sizes.push(blob.size)
    tr.pendingWrites++
    tr.writeQueue = tr.writeQueue.then(async () => {
      const t = performance.now()
      try {
        await writeFile(tr.dir, name, blob)
      } catch (e) {
        tr.writeErrors++
        this.log('write-error', { track: tr.name, name, error: String(e) })
      }
      tr.maxWriteMs = Math.max(tr.maxWriteMs, Math.round(performance.now() - t))
      tr.pendingWrites--
    })
  }

  sample() {
    const m = performance.memory
    const vs = this.videoTrack?.stats
    this.samples.push({
      elapsedS: Math.round((performance.now() - this.t0) / 1000),
      heapUsedMB: m ? +(m.usedJSHeapSize / 2 ** 20).toFixed(1) : null,
      heapTotalMB: m ? +(m.totalJSHeapSize / 2 ** 20).toFixed(1) : null,
      frames: vs
        ? { delivered: vs.deliveredFrames, discarded: vs.discardedFrames, total: vs.totalFrames }
        : null,
      tracks: Object.fromEntries(
        Object.values(this.tracks).map((tr) => [
          tr.name,
          { chunks: tr.seq, MB: +(tr.bytes / 2 ** 20).toFixed(1), pending: tr.pendingWrites },
        ]),
      ),
    })
    // 统计同样落盘，浏览器崩溃后也能看到崩溃前的数据
    writeFile(this.dir, 'stats.json', JSON.stringify(this.samples)).catch(() => {})
  }

  async stop() {
    if (this.state !== 'recording') return this.status()
    this.state = 'stopping'
    clearInterval(this.sampler)
    for (const tr of Object.values(this.tracks)) tr.recorder.stop()
    await Promise.all(Object.values(this.tracks).map((tr) => tr.stopped))
    await Promise.all(Object.values(this.tracks).map((tr) => tr.writeQueue))
    this.stoppedAt = Date.now()
    this.sample()
    this.source.stop()
    this.micStream?.getTracks().forEach((tr) => tr.stop())
    await this.ctx.close()
    this.state = 'stopped'
    await writeFile(this.dir, 'meta.json', JSON.stringify(this.meta(), null, 2))
    return this.status()
  }

  meta() {
    return {
      id: this.id,
      options: { ...this.options, streamId: undefined },
      userAgent: navigator.userAgent,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      durationMs: (this.stoppedAt ?? Date.now()) - this.startedAt,
      tracks: Object.fromEntries(
        Object.values(this.tracks).map((tr) => [
          tr.name,
          {
            mimeType: tr.mimeType,
            chunks: tr.seq,
            bytes: tr.bytes,
            sizes: tr.sizes,
            maxGapMs: tr.maxGapMs,
            maxWriteMs: tr.maxWriteMs,
            writeErrors: tr.writeErrors,
          },
        ]),
      ),
      events: this.events,
    }
  }

  status() {
    return {
      id: this.id,
      state: this.state,
      elapsedS: this.t0 ? Math.round((performance.now() - this.t0) / 1000) : 0,
      last: this.samples.at(-1),
      tracks: Object.fromEntries(
        Object.values(this.tracks).map((tr) => [
          tr.name,
          {
            mimeType: tr.mimeType,
            chunks: tr.seq,
            maxGapMs: tr.maxGapMs,
            maxWriteMs: tr.maxWriteMs,
          },
        ]),
      ),
      events: this.events,
    }
  }
}
