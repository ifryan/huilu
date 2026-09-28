import { browser } from '#imports'

const OFFSCREEN_PATH = '/offscreen.html'

let creating: Promise<void> | undefined
let closing: Promise<void> | undefined

async function hasOffscreenDocument() {
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  return contexts.length > 0
}

/**
 * 按需创建离屏文档（ADR 0002）。并发调用共用同一个创建过程，
 * 否则会报「Only a single offscreen document may be created」。
 */
export async function ensureOffscreenDocument(): Promise<void> {
  await closing
  if (await hasOffscreenDocument()) return
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      // 同一个文档既录制又执行会后处理（ADR 0002）。只有 AUDIO_PLAYBACK 一个理由时，
      // Chrome 会在 30 秒没有播放声音后关闭文档；这里始终带着 USER_MEDIA / BLOBS，
      // 何时关闭由后台根据录制状态和处理队列决定（closeIdleOffscreen）
      reasons: [
        browser.offscreen.Reason.USER_MEDIA,
        browser.offscreen.Reason.AUDIO_PLAYBACK,
        browser.offscreen.Reason.BLOBS,
      ],
      justification:
        'Record tab / screen audio and video to OPFS, then transcribe, summarize and save meetings in the background',
    })
    .finally(() => (creating = undefined))
  await creating
}

export async function closeOffscreenDocument(): Promise<void> {
  await creating
  if (!(await hasOffscreenDocument())) return
  closing ??= browser.offscreen.closeDocument().finally(() => (closing = undefined))
  await closing
}

export { hasOffscreenDocument }
