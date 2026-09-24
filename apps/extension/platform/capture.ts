import { browser } from '#imports'
import type { VideoSource } from '@huilu/core'

/** 用户在系统选择框里点了「取消」 */
export class CaptureCancelledError extends Error {
  override name = 'CaptureCancelledError'
  constructor() {
    super('The user cancelled source selection')
  }
}

export interface CaptureGrant {
  streamId: string
  /** 来源是否带声音：标签页始终带；窗口 / 屏幕取决于用户是否勾选「分享音频」 */
  sourceAudio: boolean
}

/**
 * 取得采集凭证（streamId），由离屏文档用 getUserMedia 取流。
 * - 标签页：tabCapture，要求用户刚在该标签页上调用过插件（打开弹窗 / 快捷键）
 * - 窗口 / 屏幕：desktopCapture 选择框。不指定 targetTab，生成的 streamId 只能由本插件自己的页面使用
 */
export async function requestCapture(source: VideoSource, tabId: number): Promise<CaptureGrant> {
  if (source === 'tab') {
    const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId })
    return { streamId, sourceAudio: true }
  }
  return new Promise((resolve, reject) => {
    browser.desktopCapture.chooseDesktopMedia([source, 'audio'], (streamId, options) => {
      if (!streamId) reject(new CaptureCancelledError())
      else resolve({ streamId, sourceAudio: options?.canRequestAudioTrack ?? false })
    })
  })
}
