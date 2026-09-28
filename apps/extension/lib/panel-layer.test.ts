// 纯 Node DOM/API mocks：验证挂载策略与监听清理，不声称验证浏览器绘制或点击命中。
import { afterEach, expect, it, vi } from 'vitest'
import { installPanelLayer } from './panel-layer'

afterEach(() => vi.unstubAllGlobals())
it('uses a manual top layer, follows modal/fullscreen hosts, and cleans up after removal', () => {
  let parent: unknown
  const host = {
    get parentElement() {
      return parent
    },
  }
  const root = {
    append: vi.fn(() => {
      parent = root
    }),
  }
  const modal = {
    append: vi.fn(() => {
      parent = modal
    }),
  }
  let dialogs: unknown[] = []
  let observe!: () => void
  const disconnect = vi.fn()
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    fullscreenElement: null as unknown,
    querySelectorAll: () => ({ length: dialogs.length, item: (i: number) => dialogs[i] ?? null }),
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        observe = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  let open = false
  const layer = {
    className: '',
    isConnected: true,
    setAttribute: vi.fn(),
    matches: () => open,
    showPopover: vi.fn(() => {
      open = true
    }),
    hidePopover: vi.fn(() => {
      open = false
    }),
  }
  const remove = installPanelLayer(host as unknown as HTMLElement, layer as unknown as HTMLElement)
  expect(layer.setAttribute).toHaveBeenCalledWith('popover', 'manual')
  expect(open).toBe(true)
  expect(parent).toBe(root)
  dialogs = [modal]
  observe()
  expect(parent).toBe(modal)
  expect(open).toBe(true)
  dialogs = []
  observe()
  expect(parent).toBe(root)
  // 宿主网页换掉 body / 移除了宿主时重新附加。
  parent = null
  observe()
  expect(parent).toBe(root)
  const shows = layer.showPopover.mock.calls.length
  doc.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }))
  expect(layer.showPopover.mock.calls.length).toBe(shows + 1)
  remove()
  expect(open).toBe(false)
  expect(disconnect).toHaveBeenCalledOnce()
  doc.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }))
  expect(open).toBe(false)
})
