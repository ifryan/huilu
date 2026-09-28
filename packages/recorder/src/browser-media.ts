import {
  NoAudioSourceError,
  type CaptureRequest,
  type CapturedMedia,
  type MediaBackend,
  type RecorderLike,
  type RecorderWarning,
} from './media'
import { levelFromSamples } from './audio-level'
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
  const wantVideo = req.mode === 'video' || req.source !== 'tab' || !req.sourceAudio
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
  let ctx: AudioContext | undefined
  const stopAll = () => {
    source.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    void ctx?.close().catch((error: unknown) => console.warn('[huilu] audio cleanup failed', error))
  }

  try {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    // 所有声音先汇到 bus，再分两路输出：视频用的立体声轨，和转写用的单声道轨（有声音时才有）
    const bus = ctx.createGain()
    const mix = ctx.createMediaStreamDestination()
    bus.connect(mix)
    // 没有任何输入时（窗口 / 屏幕没分享声音且麦克风关闭）目标轨道不产生音频帧。
    // 接一路恒为 0 的信号保证视频里的音轨持续输出（静音）；这路静音不进转写（见下）
    const silence = ctx.createConstantSource()
    silence.offset.value = 0
    silence.connect(bus)
    silence.start()
    // 即使浏览器意外返回音轨，关闭来源音频时也不能把它接入混音。
    const sourceAudio = req.sourceAudio
      ? source.getAudioTracks().filter((t) => t.readyState !== 'ended')
      : []
    if (!req.sourceAudio) source.getAudioTracks().forEach((track) => track.stop())
    if ((req.sourceAudioRequested ?? req.sourceAudio) && sourceAudio.length === 0) {
      warnings.push('source-audio-unavailable')
    }
    if (sourceAudio.length > 0) {
      const node = ctx.createMediaStreamSource(new MediaStream(sourceAudio))
      node.connect(bus)
      // tabCapture 会让标签页静音，需要把声音播回给用户；桌面采集不会静音，播回会产生回声
      if (req.source === 'tab') node.connect(ctx.destination)
    }

    if (req.microphone.enabled) {
      try {
        mic = await openMicrophone(req.microphone.deviceId)
        ctx.createMediaStreamSource(mic).connect(bus)
      } catch {
        warnings.push('mic-unavailable')
      }
    }

    const hasAudio = sourceAudio.length > 0 || mic !== undefined
    if (!hasAudio) {
      if (req.mode === 'audio') throw new NoAudioSourceError()
      // 只保留视频：不生成转写音轨，否则会录出一整条静音，之后被当作可转写的内容上传（PR #6 审查 r4092377788）
      warnings.push('no-audio')
    }
    let transcriptAudioTrack: MediaStreamTrack | undefined
    if (hasAudio) {
      // 转写只要单声道：MediaStreamDestination 默认两声道，一条轨道不等于单声道，要显式下混。
      // 百炼 Paraformer 的发言人分离要求单声道音频，固定 24kbps 下单声道也不会被两个声道平分
      const transcript = ctx.createMediaStreamDestination()
      transcript.channelCount = 1
      transcript.channelCountMode = 'explicit'
      transcript.channelInterpretation = 'speakers'
      bus.connect(transcript)
      transcriptAudioTrack = transcript.stream.getAudioTracks()[0]
      if (!transcriptAudioTrack) throw new Error('AudioContext produced no transcript audio track')
    }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    bus.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    if (ctx.state === 'suspended') await ctx.resume()

    const audioTrack = mix.stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('AudioContext produced no audio track')
    const videoTrack = source.getVideoTracks()[0]
    const settings = videoTrack?.getSettings()

    return {
      videoTrack,
      audioTrack,
      transcriptAudioTrack,
      videoSettings:
        req.mode === 'video' && settings
          ? { width: settings.width, height: settings.height, fps: settings.frameRate }
          : undefined,
      audioLevel() {
        if (!hasAudio || ctx?.state !== 'running') return 0
        analyser.getFloatTimeDomainData(samples)
        return levelFromSamples(samples)
      },
      warnings,
      onEnded(callback) {
        // 标签页关闭 / 停止共享时来源轨道会 ended；麦克风拔出不算来源结束。
        // 注册之前就已结束的轨道不会再派发 ended，按 readyState 补一次
        let fired = false
        const once = () => {
          if (fired) return
          fired = true
          callback()
        }
        for (const track of [...source.getVideoTracks(), ...sourceAudio]) {
          if (track.readyState === 'ended') queueMicrotask(once)
          else track.addEventListener('ended', once, { once: true })
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
