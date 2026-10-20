import { browser } from '#imports'
import type { VideoSource } from '@huilu/core'
import { SourceAudioUnavailableError, videoDimensions, type VideoQuality } from '@huilu/recorder'

/** 用户在系统选择框里点了「取消」 */
export class CaptureCancelledError extends Error {
  override name = 'CaptureCancelledError'
  constructor() {
    super('The user cancelled source selection')
  }
}

/** 选择框没能打开或 API 报错（不是用户取消），message 是浏览器给出的原因 */
export class CaptureFailedError extends Error {
  override name = 'CaptureFailedError'
}

export interface CaptureGrant {
  streamId: string
  /** 是否允许请求来源音轨；实际是否获得音轨仍以取流结果为准 */
  sourceAudio: boolean
}

/**
 * 标签页采集凭证（streamId），由离屏文档用 getUserMedia 取流。
 * 要求用户刚在该标签页上调用过插件（打开弹窗 / 快捷键）。
 */
export async function requestTabCapture(tabId: number, sourceAudio = true): Promise<CaptureGrant> {
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId })
  return { streamId, sourceAudio }
}

/**
 * 窗口 / 屏幕选择框，只能在可见的插件页面（录制窗口）里调用：
 * - 后台 Service Worker 调用会直接报错「A target tab is required when called from a service worker context」
 * - 离屏文档调用不会显示选择框，一直等不到结果
 * - 得到的 streamId 只能在调用它的同一个页面里取流，所以录制也在这个页面里进行
 */
export function chooseDesktopSource(
  source: 'window' | 'screen' | 'choose',
  sourceAudio = true,
): Promise<CaptureGrant> {
  return new Promise((resolve, reject) => {
    const sources = source === 'choose' ? (['tab', 'window', 'screen'] as const) : [source]
    browser.desktopCapture.chooseDesktopMedia(
      sourceAudio ? [...sources, 'audio'] : [...sources],
      (streamId, options) => {
        const lastError = browser.runtime.lastError?.message
        if (lastError) reject(new CaptureFailedError(lastError))
        else if (!streamId) reject(new CaptureCancelledError())
        else
          resolve({
            streamId,
            sourceAudio: sourceAudio && (options?.canRequestAudioTrack ?? false),
          })
      },
    )
  })
}

type IncludeExclude = 'include' | 'exclude'
/** Chrome 支持的 getDisplayMedia 提示项，TypeScript 的 DOM 类型还没收录 */
type DisplayOptions = DisplayMediaStreamOptions & {
  systemAudio: IncludeExclude
  windowAudio: 'system' | 'window' | 'exclude'
  selfBrowserSurface: IncludeExclude
  surfaceSwitching: IncludeExclude
  monitorTypeSurfaces: IncludeExclude
}

/**
 * 页面内录制的统一来源选择（entrypoints/capture.content）：用网页标准的 getDisplayMedia，
 * 它能给窗口来源带上系统声音，插件的 chooseDesktopMedia 做不到。必须在网页内点击的同步调用栈里调用。
 * 窗口 / 整个屏幕的声音开关由 Chrome 决定默认关闭，用户需要在选择框里打开
 */
export async function openDisplaySource(
  sourceAudio: boolean,
  quality: VideoQuality | null,
): Promise<{ stream: MediaStream; source: VideoSource }> {
  const dimensions = quality ? videoDimensions(quality) : { width: 640, height: 360 }
  const displayOptions: DisplayOptions = {
    video: {
      width: { max: dimensions.width },
      height: { max: dimensions.height },
      frameRate: { max: quality?.fps ?? 1 },
    },
    audio: sourceAudio,
    // 来源声音：标签页录标签页声音（audio），窗口和整个屏幕录系统声音
    systemAudio: sourceAudio ? 'include' : 'exclude',
    windowAudio: sourceAudio ? 'system' : 'exclude',
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'include',
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(displayOptions)
  } catch (error) {
    // 用户在选择框里点了取消；macOS 没给 Chrome 录屏权限时是 Permission denied by system，单独提示
    if (
      error instanceof DOMException &&
      error.name === 'NotAllowedError' &&
      !error.message.includes('by system')
    ) {
      throw new CaptureCancelledError()
    }
    throw error
  }
  try {
    return { stream, source: selectedSource(stream.getVideoTracks()[0]?.getSettings() ?? {}) }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }
}

/** Never guess the selected surface from the requested preference or track label. */
export function selectedSource(settings: MediaTrackSettings): VideoSource {
  switch (settings.displaySurface) {
    case 'browser':
      return 'tab'
    case 'window':
      return 'window'
    case 'monitor':
      return 'screen'
    default:
      throw new CaptureFailedError('The browser did not identify the selected recording source')
  }
}

/** Desktop tokens, including selected tabs, must be consumed as desktop in the visible host. */
export async function openChosenSource(
  grant: CaptureGrant,
  requestedAudio: boolean,
  quality: VideoQuality | null,
): Promise<{ stream: MediaStream; source: VideoSource }> {
  // Do not open any media devices when the native picker declined requested audio.
  if (requestedAudio && !grant.sourceAudio) throw new SourceAudioUnavailableError()
  const base = { chromeMediaSource: 'desktop', chromeMediaSourceId: grant.streamId }
  const dimensions = quality ? videoDimensions(quality) : { width: 640, height: 360 }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      mandatory: {
        ...base,
        maxWidth: dimensions.width,
        maxHeight: dimensions.height,
        maxFrameRate: quality?.fps ?? 1,
      },
    },
    audio: grant.sourceAudio ? { mandatory: { ...base } } : false,
  } as MediaStreamConstraints)
  try {
    return { stream, source: selectedSource(stream.getVideoTracks()[0]?.getSettings() ?? {}) }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }
}
