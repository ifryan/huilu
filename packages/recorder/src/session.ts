import type { Meeting, RecordingMode, VideoSource } from '@huilu/core'
import type { EndReason, RecordingManifest, TrackName } from './manifest'
import {
  type CaptureRequest,
  type CapturedMedia,
  type MediaBackend,
  type RecorderLike,
  type RecorderWarning,
} from './media'
import { meetingFromManifest } from './meeting'
import { AUDIO_MIME_CANDIDATES, VIDEO_MIME_CANDIDATES, pickMimeType } from './mime'
import {
  KEYFRAME_INTERVAL_MS,
  TIMESLICE_MS,
  TRANSCRIPT_AUDIO_BITRATE,
  VIDEO_AUDIO_BITRATE,
  estimateBytesPerHour,
  videoBitrate,
} from './quality'
import type { RecordingDir, RecordingStore } from './store'

export interface RecordingOptions extends CaptureRequest {
  id: string
  title: string
  /** 音视频语言：zh / en / zh-en / auto */
  language: string
}

export type SessionState = 'starting' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'failed'

export interface SessionStatus {
  id: string
  state: SessionState
  title: string
  mode: RecordingMode
  videoSource: VideoSource
  startedAt?: number
  /** 不含暂停的录制时长 */
  elapsedMs: number
  /** 已写入并校验通过的字节数 */
  bytes: number
  warnings: RecorderWarning[]
  error?: string
}

export interface FinishedRecording {
  id: string
  title: string
  mode: RecordingMode
  endReason: EndReason
  durationMs: number
  bytes: number
  error?: string
  /** 成功收尾时为 status = processing 的 meeting.json；没录到可用数据或收尾写入失败时为空 */
  meeting?: Meeting
}

export class InsufficientStorageError extends Error {
  override name = 'InsufficientStorageError'
}

export interface SessionDeps {
  store: RecordingStore
  media: MediaBackend
  now?: () => number
  /** 等待 MediaRecorder 输出最后一个分片的上限，防止异常的录制器让「结束」一直卡住 */
  stopTimeoutMs?: number
}

/** 开始录制前至少要能录 10 分钟 */
const MIN_START_HOURS = 1 / 6

/** 一条轨道的分片按顺序逐个写入；任何一片写失败，之后的分片都不再写（拼接时不能有缺口） */
class TrackWriter {
  seq = 0
  bytes = 0
  readonly sizes: number[] = []
  #queue: Promise<void> = Promise.resolve()
  #failed = false
  #sealed = false

  constructor(
    readonly name: TrackName,
    readonly recorder: RecorderLike,
    private readonly write: (seq: number, data: Blob) => Promise<void>,
    private readonly afterWrite: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  push(data: Blob) {
    if (data.size === 0 || this.#sealed) return
    this.#queue = this.#queue.then(async () => {
      if (this.#failed) return
      try {
        await this.write(this.seq + 1, data)
        this.seq += 1
        this.bytes += data.size
        this.sizes.push(data.size)
        await this.afterWrite()
      } catch (e) {
        this.#failed = true
        this.onError(e)
      }
    })
  }

  /** 收尾：等已排队的分片写完，之后再到达的分片（录制器超时后才吐出的数据）一律丢弃 */
  async seal() {
    await this.#queue
    this.#sealed = true
  }
}

/**
 * 一次录制：采集 → 两路 MediaRecorder（视频 + 转写音频）→ 每 5 秒一个分片写入 OPFS。
 * 每写完一个分片就更新 manifest.json，浏览器崩溃后可以据此恢复。
 */
export class RecordingSession {
  state: SessionState = 'starting'
  readonly finished: Promise<FinishedRecording>

  #resolveFinished!: (r: FinishedRecording) => void
  #dir?: RecordingDir
  #media?: CapturedMedia
  #writers: TrackWriter[] = []
  #warnings: RecorderWarning[] = []
  #startedAt?: number
  #pausedAt?: number
  #pausedMs = 0
  #endedAt?: number
  #endReason?: EndReason
  #error?: string
  #stopping?: Promise<FinishedRecording>
  #manifestQueue: Promise<void> = Promise.resolve()
  #videoSettings?: CapturedMedia['videoSettings']
  readonly #now: () => number

  constructor(
    readonly options: RecordingOptions,
    private readonly deps: SessionDeps,
  ) {
    this.#now = deps.now ?? Date.now
    this.finished = new Promise((resolve) => (this.#resolveFinished = resolve))
  }

  get active() {
    return this.state !== 'stopped' && this.state !== 'failed'
  }

  async start(): Promise<SessionStatus> {
    const o = this.options
    const { media, store } = this.deps
    const quality = o.mode === 'video' ? o.quality : null
    try {
      const available = await media.availableBytes?.()
      if (available !== undefined) {
        const perHour = estimateBytesPerHour(quality)
        if (available < perHour * MIN_START_HOURS) {
          throw new InsufficientStorageError(`Only ${available} bytes of storage left`)
        }
        if (available < perHour) this.#warnings.push('low-storage')
      }

      const videoMime =
        o.mode === 'video' ? pickMimeType(VIDEO_MIME_CANDIDATES, media.isTypeSupported) : undefined
      const audioMime = pickMimeType(AUDIO_MIME_CANDIDATES, media.isTypeSupported)
      if ((o.mode === 'video' && !videoMime) || !audioMime) {
        throw new Error('This browser cannot record any supported format')
      }

      this.#media = await media.capture(o)
      this.#warnings.push(...this.#media.warnings)
      this.#videoSettings = this.#media.videoSettings
      this.#dir = await store.create(o.id)

      if (o.mode === 'video') {
        const { videoTrack, audioTrack } = this.#media
        if (!videoTrack) throw new Error('Video capture returned no video track')
        this.#addTrack(
          'video',
          media.createRecorder([videoTrack, audioTrack], {
            mimeType: videoMime,
            videoBitsPerSecond: videoBitrate(o.quality),
            audioBitsPerSecond: VIDEO_AUDIO_BITRATE,
            videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
          }),
        )
      }
      this.#addTrack(
        'audio',
        media.createRecorder([this.#media.transcriptAudioTrack], {
          mimeType: audioMime,
          audioBitsPerSecond: TRANSCRIPT_AUDIO_BITRATE,
        }),
      )

      this.#startedAt = this.#now()
      // manifest 先落盘再开始录：之后任何时刻崩溃都能在「恢复未完成的录制」里看到它
      await this.#persistManifest()
      this.#media.onEnded(() => void this.stop('source-ended').catch(() => {}))
      for (const w of this.#writers) w.recorder.start(TIMESLICE_MS)
      this.state = 'recording'
      return this.status()
    } catch (e) {
      this.state = 'failed'
      for (const w of this.#writers) if (w.recorder.state !== 'inactive') w.recorder.stop()
      this.#media?.stop()
      if (this.#dir) await store.remove(o.id).catch(() => {})
      throw e
    }
  }

  #addTrack(name: TrackName, recorder: RecorderLike) {
    const writer = new TrackWriter(
      name,
      recorder,
      (seq, data) => this.#dir!.writeChunk(name, seq, data),
      () => this.#persistManifest(),
      (e) => this.#fail(e),
    )
    recorder.ondataavailable = (event) => writer.push(event.data)
    recorder.onerror = (event) => {
      const error = (event as Event & { error?: unknown }).error
      this.#fail(error ?? new Error(`MediaRecorder error on ${name} track`))
    }
    this.#writers.push(writer)
  }

  /**
   * 写入失败即停止：继续录只会产生无法使用的数据，而用户看到的仍是「录制中」。
   * 不能在写入队列里等待 stop()（stop 要等写入队列清空），所以放到下一轮事件循环。
   */
  #fail(error: unknown) {
    if (this.#error !== undefined) return
    this.#error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    setTimeout(() => this.stop('error').catch(() => {}), 0)
  }

  pause(): SessionStatus {
    if (this.state === 'recording') {
      for (const w of this.#writers) w.recorder.pause()
      this.#pausedAt = this.#now()
      this.state = 'paused'
      void this.#persistManifest().catch((e) => this.#fail(e))
    }
    return this.status()
  }

  resume(): SessionStatus {
    if (this.state === 'paused') {
      for (const w of this.#writers) w.recorder.resume()
      this.#pausedMs += this.#now() - (this.#pausedAt ?? this.#now())
      this.#pausedAt = undefined
      this.state = 'recording'
      void this.#persistManifest().catch((e) => this.#fail(e))
    }
    return this.status()
  }

  stop(reason: EndReason = 'user'): Promise<FinishedRecording> {
    if (this.#stopping) return this.#stopping
    if (this.state !== 'recording' && this.state !== 'paused') {
      return Promise.reject(new Error(`Cannot stop a ${this.state} recording`))
    }
    this.#stopping = this.#doStop(reason)
    return this.#stopping
  }

  async #doStop(reason: EndReason): Promise<FinishedRecording> {
    // 写入失败触发的停止，即使用户随后点了结束，也要如实记录为错误
    this.#endReason = this.#error !== undefined ? 'error' : reason
    if (this.#pausedAt !== undefined) {
      this.#pausedMs += this.#now() - this.#pausedAt
      this.#pausedAt = undefined
    }
    this.state = 'stopping'
    this.#endedAt = this.#now()

    await Promise.all(this.#writers.map((w) => this.#stopRecorder(w.recorder)))
    await Promise.all(this.#writers.map((w) => w.seal()))
    this.#media?.stop()

    const manifest = this.#manifest()
    const audio = manifest.tracks.audio
    let meeting: Meeting | undefined
    if (!audio || audio.chunks === 0) {
      // 一个分片都没写成：没有可保留的内容
      this.#error ??= 'No data was recorded'
      await this.#manifestQueue
      await this.deps.store.remove(this.options.id).catch(() => {})
      this.state = 'failed'
    } else {
      try {
        // 先写 meeting.json 再把 manifest 标为 stopped：两步之间崩溃，下次会作为未完成的录制重新收尾
        meeting = meetingFromManifest(manifest)
        await this.#dir!.writeMeeting(meeting)
        manifest.state = 'stopped'
        await this.#writeManifest(() => manifest)
        this.state = 'stopped'
      } catch (e) {
        meeting = undefined
        this.#error ??= e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        this.state = 'failed'
      }
    }

    const result: FinishedRecording = {
      id: this.options.id,
      title: this.options.title,
      mode: this.options.mode,
      endReason: this.#endReason,
      durationMs: Math.round(manifest.activeMs),
      bytes: this.#bytes(),
      error: this.#error,
      meeting,
    }
    this.#resolveFinished(result)
    return result
  }

  #stopRecorder(recorder: RecorderLike) {
    if (recorder.state === 'inactive') return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.deps.stopTimeoutMs ?? 10_000)
      recorder.onstop = () => {
        clearTimeout(timer)
        // 最后一个 dataavailable 在 stop 事件之前派发，此时已经进了写入队列
        resolve()
      }
      recorder.stop()
    })
  }

  #elapsedMs() {
    if (this.#startedAt === undefined) return 0
    const end = this.#endedAt ?? this.#now()
    const pausing = this.#pausedAt !== undefined ? end - this.#pausedAt : 0
    return Math.max(0, end - this.#startedAt - this.#pausedMs - pausing)
  }

  #bytes() {
    return this.#writers.reduce((sum, w) => sum + w.bytes, 0)
  }

  #manifest(): RecordingManifest {
    const o = this.options
    return {
      version: 1,
      id: o.id,
      title: o.title,
      mode: o.mode,
      videoSource: o.source,
      language: o.language,
      microphone: o.microphone.enabled && !this.#warnings.includes('mic-unavailable'),
      quality: o.mode === 'video' ? o.quality : undefined,
      video: this.#videoSettings,
      // 收尾时由 #doStop 显式改为 stopped / failed：只有 meeting.json 写好之后才能标记为 stopped
      state: this.state === 'paused' ? 'paused' : 'recording',
      startedAt: this.#startedAt ?? this.#now(),
      updatedAt: this.#now(),
      activeMs: this.#elapsedMs(),
      endReason: this.#endReason,
      error: this.#error,
      tracks: Object.fromEntries(
        this.#writers.map((w) => [
          w.name,
          {
            mimeType: w.recorder.mimeType,
            chunks: w.seq,
            bytes: w.bytes,
            sizes: [...w.sizes],
          },
        ]),
      ),
    }
  }

  /**
   * manifest 的写入串行执行（两条轨道同时写完分片时不会互相覆盖出错），
   * 内容在轮到写入时才生成，保证落盘的是最新状态。
   */
  #writeManifest(produce: () => RecordingManifest): Promise<void> {
    const write = this.#manifestQueue.then(() => this.#dir!.writeManifest(produce()))
    this.#manifestQueue = write.catch(() => {})
    return write
  }

  #persistManifest(): Promise<void> {
    return this.#writeManifest(() => this.#manifest())
  }

  status(): SessionStatus {
    const o = this.options
    return {
      id: o.id,
      state: this.state,
      title: o.title,
      mode: o.mode,
      videoSource: o.source,
      startedAt: this.#startedAt,
      elapsedMs: this.#elapsedMs(),
      bytes: this.#bytes(),
      warnings: [...this.#warnings],
      error: this.#error,
    }
  }
}
