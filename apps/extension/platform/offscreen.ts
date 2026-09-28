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
      reasons: [
        browser.offscreen.Reason.USER_MEDIA,
        browser.offscreen.Reason.AUDIO_PLAYBACK,
        browser.offscreen.Reason.BLOBS,
      ],
      justification: 'Record tab / screen audio and video, and write chunks to OPFS',
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
