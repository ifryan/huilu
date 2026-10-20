/** 只识别扩展重载后的预期失效；其他错误必须保留诊断。 */
export function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /Extension context invalidated\.?$/i.test(error.message)
}

let invalidate: (() => void) | undefined
export function onExtensionContextInvalidated(callback: () => void) {
  invalidate = callback
  return () => {
    invalidate = undefined
  }
}

export function reportPanelError(error: unknown) {
  if (isExtensionContextInvalidated(error)) invalidate?.()
  else console.error('[huilu] recording panel failed', error)
}

export function checkMessageError(error: unknown) {
  if (isExtensionContextInvalidated(error)) invalidate?.()
}

/** 是否在插件自己的页面里（弹窗 / 插件网页 / 离屏文档）；网页面板是内容脚本，运行在网页的源下 */
export function inExtensionPage(): boolean {
  return globalThis.location?.protocol === 'chrome-extension:'
}
