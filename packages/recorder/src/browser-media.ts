import {
  NoAudioSourceError,
  type CaptureRequest,
  type CapturedMedia,
  type MediaBackend,
  type RecorderLike,
  type RecorderWarning,
} from './media'
import { videoDimensions } from './quality'

/**
 * Chrome 的 chromeMediaSource 约束（tabCapture / desktopCapture 的 streamId 需要用它取流）。
 * 这是 getUserMedia 的 Chrome 专有写法，不涉及 chrome.* 扩展 API。
 */
type ChromeConstraints = MediaTrackConstraints & { mandatory: Record<string, unknown> }

function sourceConstraints(req: CaptureRequest) {
  const chromeMediaSource = req.source === 'tab' ? 'tab' : 'desktop'
  const base = { chromeMediaSource, chromeMediaSourceId: req.streamId }
  const { width, height } = videoDimensions(req.quality)
  // 窗口 / 屏幕的仅音频模式也必须取画面（desktopCapture 不能只取声音）：用最低规格，只为感知「停止共享」
  const wantVideo = req.mode === 'video' || req.source !== 'tab'
  const video: ChromeConstraints | false = wantVideo
    ? {
        mandatory:
          req.mode === 'video'
            ? { ...base, maxWidth: width, maxHeight: height, maxFrameRate: req.quality.fps }
            : { ...base, maxWidth: 640, maxHeight: 360, maxFrameRate: 1 },
      }
    : false
  const audio: ChromeConstraints | false = req.sourceAudio ? { mandatory: { ...base } } : false
  return { video, audio } as MediaStreamConstraints
}

async function openMicrophone(deviceId: string | undefined) {
  // 离屏文档不能弹授权框：麦克风权限必须事先在可见的插件页面里授予过（ADR 0004 第 2 节）
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
}

/** 采集来源 + 麦克风，用 Web Audio 混成一条音轨 */
async function capture(req: CaptureRequest): Promise<CapturedMedia> {
  const warnings: RecorderWarning[] = []
  const source = await navigator.mediaDevices.getUserMedia(sourceConstraints(req))
  let mic: MediaStream | undefined
  const ctx = new AudioContext({ latencyHint: 'playback' })
  const stopAll = () => {
    source.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  try {
    const mix = ctx.createMediaStreamDestination()
    const sourceAudio = source.getAudioTracks()
    if (sourceAudio.length > 0) {
      const node = ctx.createMediaStreamSource(new MediaStream(sourceAudio))
      node.connect(mix)
      // tabCapture 会让标签页静音，需要把声音播回给用户；桌面采集不会静音，播回会产生回声
      if (req.source === 'tab') node.connect(ctx.destination)
    }

    if (req.microphone.enabled) {
      try {
        mic = await openMicrophone(req.microphone.deviceId)
        ctx.createMediaStreamSource(mic).connect(mix)
      } catch {
        warnings.push('mic-unavailable')
      }
    }

    if (sourceAudio.length === 0 && !mic) {
      if (req.mode === 'audio') throw new NoAudioSourceError()
      warnings.push('no-audio')
    }
    if (ctx.state === 'suspended') await ctx.resume()

    const audioTrack = mix.stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('AudioContext produced no audio track')
    const videoTrack = source.getVideoTracks()[0]
    const settings = videoTrack?.getSettings()

    return {
      videoTrack,
      audioTrack,
      transcriptAudioTrack: audioTrack.clone(),
      videoSettings:
        req.mode === 'video' && settings
          ? { width: settings.width, height: settings.height, fps: settings.frameRate }
          : undefined,
      warnings,
      onEnded(callback) {
        // 标签页关闭 / 停止共享时来源轨道会 ended；麦克风拔出不算来源结束
        for (const track of source.getTracks()) {
          track.addEventListener('ended', callback, { once: true })
        }
      },
      stop: stopAll,
    }
  } catch (e) {
    stopAll()
    throw e
  }
}

export const browserMediaBackend: MediaBackend = {
  capture,
  createRecorder: (tracks, options) =>
    new MediaRecorder(new MediaStream(tracks), options) as unknown as RecorderLike,
  isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  async availableBytes() {
    const { quota, usage } = await navigator.storage.estimate()
    return quota === undefined || usage === undefined ? undefined : quota - usage
  },
}
