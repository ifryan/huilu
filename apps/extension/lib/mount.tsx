import '@huilu/ui/styles.css'
import { DEFAULT_LOCALE, I18nextProvider, detectLocale, initI18n } from '@huilu/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { isExtensionContextInvalidated } from './extension-context'
import { localeSetting } from './settings'

/** 所有 React 页面共用的启动逻辑；悬浮面板不修改宿主网页的语言。 */
export async function mount(node: ReactNode) {
  const container = document.getElementById('root')!
  await mountInto(container, node).ready
  document.documentElement.lang = container.lang
  localeSetting.watch((next) => next && (document.documentElement.lang = next))
}

export interface MountedApp {
  ready: Promise<void>
  /** 同步、幂等：必须在 WXT 清空 React 容器之前完成。 */
  unmount(): void
}

export function mountInto(container: HTMLElement, node: ReactNode): MountedApp {
  let disposed = false
  let root: Root | undefined
  let unwatch: (() => void) | undefined
  const queryClient = new QueryClient()
  const ready = (async () => {
    const saved = await localeSetting.getValue()
    if (disposed) return
    const locale = saved ?? detectLocale(navigator.languages ?? [DEFAULT_LOCALE])
    const i18n = await initI18n(locale)
    if (disposed) return
    container.lang = locale
    unwatch = localeSetting.watch((next) => {
      if (next && !disposed) {
        void i18n.changeLanguage(next)
        container.lang = next
      }
    })
    root = createRoot(container)
    root.render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
        </I18nextProvider>
      </StrictMode>,
    )
  })()
  return {
    ready,
    unmount() {
      if (disposed) return
      disposed = true
      try {
        unwatch?.()
      } catch (error) {
        if (!isExtensionContextInvalidated(error))
          console.error('[huilu] locale cleanup failed', error)
      } finally {
        // 即使 chrome.storage 已失效，也必须释放 React 的轮询和订阅。
        root?.unmount()
        queryClient.clear()
      }
    },
  }
}
