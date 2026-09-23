import '@huilu/ui/styles.css'
import { DEFAULT_LOCALE, I18nextProvider, detectLocale, initI18n } from '@huilu/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { localeSetting } from './settings'

const queryClient = new QueryClient()

/** 所有 React 页面（弹窗、侧边栏、插件网页）共用的启动逻辑：i18n + 数据请求 */
export async function mount(node: ReactNode) {
  const saved = await localeSetting.getValue()
  const locale = saved ?? detectLocale(navigator.languages ?? [DEFAULT_LOCALE])
  const i18n = await initI18n(locale)
  document.documentElement.lang = locale

  localeSetting.watch((next) => {
    if (next) {
      void i18n.changeLanguage(next)
      document.documentElement.lang = next
    }
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  )
}
