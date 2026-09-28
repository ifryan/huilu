import '@huilu/ui/styles.css'
import { DEFAULT_LOCALE, I18nextProvider, detectLocale, initI18n } from '@huilu/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { localeSetting } from './settings'

const queryClient = new QueryClient()

/** 所有 React 页面（弹窗、插件网页、录制窗口）共用的启动逻辑：i18n + 数据请求 */
export async function mount(node: ReactNode) {
  const container = document.getElementById('root')!
  await mountInto(container, node)
  document.documentElement.lang = container.lang
  localeSetting.watch((next) => next && (document.documentElement.lang = next))
}

export interface MountedApp {
  /** 卸载 React 并释放语言设置的监听 */
  unmount(): void
}

/**
 * 挂载到任意容器（页面内悬浮面板挂在 Shadow DOM 里，不改网页的 html lang）。
 * 面板会被反复移除 / 重新注入：移除时要调用 unmount，否则每次注入都多留一个语言监听（PR #6 审查 r4118276868）
 */
export async function mountInto(container: HTMLElement, node: ReactNode): Promise<MountedApp> {
  const saved = await localeSetting.getValue()
  const locale = saved ?? detectLocale(navigator.languages ?? [DEFAULT_LOCALE])
  const i18n = await initI18n(locale)
  container.lang = locale

  const unwatch = localeSetting.watch((next) => {
    if (next) {
      void i18n.changeLanguage(next)
      container.lang = next
    }
  })

  const root = createRoot(container)
  root.render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  )
  return {
    unmount() {
      unwatch()
      root.unmount()
    },
  }
}
