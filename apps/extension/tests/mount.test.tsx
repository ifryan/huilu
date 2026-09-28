// 悬浮面板反复关闭 / 重新显示时，语言设置的监听要随面板一起释放（PR #6 审查 r4118276868）
import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  watchers: new Set<(next: string | null) => void>(),
  unmounted: 0,
  mounted: 0,
  load: (): Promise<string> => Promise.resolve('zh-CN'),
  cleanupError: undefined as Error | undefined,
}))

vi.mock('@/lib/settings', () => ({
  localeSetting: {
    getValue: () => h.load(),
    watch: (callback: (next: string | null) => void) => {
      h.watchers.add(callback)
      return () => {
        h.watchers.delete(callback)
        if (h.cleanupError) throw h.cleanupError
      }
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
  createRoot: () => {
    h.mounted++
    return { render: () => {}, unmount: () => void h.unmounted++ }
  },
}))

const { mountInto } = await import('@/lib/mount')

beforeEach(() => {
  h.watchers.clear()
  h.unmounted = 0
  h.mounted = 0
  h.load = () => Promise.resolve('zh-CN')
  h.cleanupError = undefined
})

it('releases the locale watcher when an injected panel is removed', async () => {
  for (let i = 0; i < 3; i++) {
    const container = { lang: '' } as HTMLElement
    const mounted = mountInto(container, <div />)
    await mounted.ready
    expect(h.watchers.size).toBe(1)
    mounted.unmount()
  }
  expect(h.watchers.size).toBe(0)
  expect(h.unmounted).toBe(3)
})

it('still follows locale changes while mounted', async () => {
  const container = { lang: '' } as HTMLElement
  await mountInto(container, <div />).ready
  for (const watch of h.watchers) watch('en')
  expect(container.lang).toBe('en')
})

it('unmounts synchronously before the outer UI removes React children, once only', async () => {
  const mounted = mountInto({ lang: '' } as HTMLElement, <div />)
  await mounted.ready
  mounted.unmount()
  expect(h.unmounted).toBe(1) // WXT removes its children immediately after this call
  mounted.unmount()
  expect(h.unmounted).toBe(1)
})

it('does not mount or subscribe if removed during asynchronous locale loading', async () => {
  let resolve!: (value: string) => void
  h.load = () =>
    new Promise((r) => {
      resolve = r
    })
  const mounted = mountInto({ lang: '' } as HTMLElement, <div />)
  mounted.unmount()
  resolve('zh-CN')
  await mounted.ready
  expect(h.mounted).toBe(0)
  expect(h.watchers.size).toBe(0)
})

it('still unmounts React when storage cleanup encounters an invalid context', async () => {
  const mounted = mountInto({ lang: '' } as HTMLElement, <div />)
  await mounted.ready
  h.cleanupError = new Error('Extension context invalidated.')
  mounted.unmount()
  expect(h.unmounted).toBe(1)
})
