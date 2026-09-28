// 悬浮面板反复关闭 / 重新显示时，语言设置的监听要随面板一起释放（PR #6 审查 r4118276868）
import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  watchers: new Set<(next: string | null) => void>(),
  unmounted: 0,
}))

vi.mock('@/lib/settings', () => ({
  localeSetting: {
    getValue: async () => 'zh-CN',
    watch: (callback: (next: string | null) => void) => {
      h.watchers.add(callback)
      return () => void h.watchers.delete(callback)
    },
  },
}))
vi.mock('@huilu/i18n', () => ({
  DEFAULT_LOCALE: 'zh-CN',
  detectLocale: () => 'zh-CN',
  initI18n: async () => ({ changeLanguage: async () => {} }),
  I18nextProvider: () => null,
}))
// 测试环境没有 DOM：只关心挂载 / 卸载是否成对
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: () => {}, unmount: () => void h.unmounted++ }),
}))

const { mountInto } = await import('@/lib/mount')

beforeEach(() => {
  h.watchers.clear()
  h.unmounted = 0
})

it('releases the locale watcher when an injected panel is removed', async () => {
  for (let i = 0; i < 3; i++) {
    const container = { lang: '' } as HTMLElement
    const mounted = await mountInto(container, <div />)
    expect(h.watchers.size).toBe(1)
    mounted.unmount()
  }
  expect(h.watchers.size).toBe(0)
  expect(h.unmounted).toBe(3)
})

it('still follows locale changes while mounted', async () => {
  const container = { lang: '' } as HTMLElement
  await mountInto(container, <div />)
  for (const watch of h.watchers) watch('en')
  expect(container.lang).toBe('en')
})
