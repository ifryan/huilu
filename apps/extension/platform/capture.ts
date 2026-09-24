import { browser } from '#imports'

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
  /** 来源是否带声音：标签页始终带；窗口 / 屏幕取决于用户是否勾选「分享音频」 */
  sourceAudio: boolean
}

/**
 * 标签页采集凭证（streamId），由离屏文档用 getUserMedia 取流。
 * 要求用户刚在该标签页上调用过插件（打开弹窗 / 快捷键）。
 */
export async function requestTabCapture(tabId: number): Promise<CaptureGrant> {
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId })
  return { streamId, sourceAudio: true }
}

/**
 * 窗口 / 屏幕选择框，只能在可见的插件页面（录制窗口）里调用：
 * - 后台 Service Worker 调用会直接报错「A target tab is required when called from a service worker context」
 * - 离屏文档调用不会显示选择框，一直等不到结果
 * - 得到的 streamId 只能在调用它的同一个页面里取流，所以录制也在这个页面里进行
 */
export function chooseDesktopSource(source: 'window' | 'screen'): Promise<CaptureGrant> {
  return new Promise((resolve, reject) => {
    browser.desktopCapture.chooseDesktopMedia([source, 'audio'], (streamId, options) => {
      const lastError = browser.runtime.lastError?.message
      if (lastError) reject(new CaptureFailedError(lastError))
      else if (!streamId) reject(new CaptureCancelledError())
      else resolve({ streamId, sourceAudio: options?.canRequestAudioTrack ?? false })
    })
  })
}
