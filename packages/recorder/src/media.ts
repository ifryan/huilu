import type { RecordingMode, VideoSource } from '@huilu/core'
import type { VideoQuality } from './quality'

export type RecorderWarning =
  /** 麦克风打开了但拿不到（未授权 / 设备被占用 / 已拔出），录制继续但不含麦克风 */
  | 'mic-unavailable'
  /** 用户希望录制来源音频，但浏览器未提供该音轨（麦克风可能仍可用） */
  | 'source-audio-unavailable'
  /** 既没有来源声音也没有麦克风：视频可以录，但没有可转写的内容 */
  | 'no-audio'
  /** 剩余空间不足以录满 1 小时 */
  | 'low-storage'

export interface CaptureRequest {
  mode: RecordingMode
  source: VideoSource
  /** 平台层拿到的采集凭证：标签页为 tabCapture streamId，窗口 / 屏幕为 desktopCapture streamId */
  streamId: string
  /** 用户选择与浏览器授权都允许采集来源音频时才为 true */
  sourceAudio: boolean
  /** 选源之前的用户意图，区分主动关闭与浏览器未授权音频 */
  sourceAudioRequested?: boolean
  quality: VideoQuality
  microphone: { enabled: boolean; deviceId?: string }
}

export interface CapturedMedia {
  /** 视频模式下录制的画面；窗口 / 屏幕的仅音频模式也会保留它，用来感知「停止共享」 */
  videoTrack?: MediaStreamTrack
  /** 来源声音 + 麦克风混音后的音轨 */
  audioTrack: MediaStreamTrack
  /**
   * 转写音频轨：同一路混音下混成单声道，给第二个 MediaRecorder 用。
   * 既没有来源声音也没有麦克风（warning no-audio）时为空：不录一条静音冒充可转写的音频
   */
  transcriptAudioTrack?: MediaStreamTrack
  videoSettings?: { width?: number; height?: number; fps?: number }
  /** 从实际混音读取 0…1 的 RMS 电平，不额外打开采集设备 */
  audioLevel?(): number
  warnings: RecorderWarning[]
  /** 来源结束（标签页关闭、用户点了「停止共享」）时回调 */
  onEnded(callback: () => void): void
  stop(): void
}

export type RecorderOptions = MediaRecorderOptions & {
  /** Chrome 扩展选项：强制关键帧间隔，MP4 只能在关键帧处切分片 */
  videoKeyFrameIntervalDuration?: number
}

/** MediaRecorder 中录制会话用到的部分，测试里用假的实现替换 */
export interface RecorderLike {
  readonly mimeType: string
  readonly state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: Event) => void) | null
  start(timeslice?: number): void
  stop(): void
  pause(): void
  resume(): void
}

/** 录制会话依赖的浏览器能力：由平台注入，单元测试中用假的实现 */
export interface MediaBackend {
  capture(request: CaptureRequest): Promise<CapturedMedia>
  createRecorder(tracks: MediaStreamTrack[], options: RecorderOptions): RecorderLike
  isTypeSupported(mimeType: string): boolean
  /** 剩余可用存储空间（字节），无法获取时返回 undefined */
  availableBytes?(): Promise<number | undefined>
}

export class NoAudioSourceError extends Error {
  override name = 'NoAudioSourceError'
  constructor() {
    super('No audio to record: the source has no audio and the microphone is off or unavailable')
  }
}
