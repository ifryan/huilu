// 纯 Node DOM/API mocks：验证挂载策略与监听清理，不声称验证浏览器绘制或点击命中。
import { afterEach, expect, it, vi } from 'vitest'
import { installPanelLayer } from './panel-layer'

afterEach(() => vi.unstubAllGlobals())
function fixture(initial: ('a' | 'b')[] = [], active?: 'a' | 'b') {
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
  const dialog = () => {
    const node = {
      append: vi.fn(() => {
        parent = node
      }),
      closest: () => node,
      matches: () => true,
    }
    return node
  }
  const a = dialog(),
    b = dialog()
  let dialogs = initial.map((key) => (key === 'a' ? a : b))
  let observe!: (records: Partial<MutationRecord>[]) => void
  const disconnect = vi.fn()
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    activeElement: active === 'a' ? a : active === 'b' ? b : null,
    fullscreenElement: null as unknown,
    querySelectorAll: () => dialogs,
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: typeof observe) {
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
  return {
    host,
    root,
    a,
    b,
    doc,
    layer,
    remove,
    disconnect,
    parent: () => parent,
    isOpen: () => open,
    setDialogs: (next: typeof dialogs) => {
      dialogs = next
    },
    observe: (records: Partial<MutationRecord>[] = []) => observe(records),
    detach: () => {
      parent = null
    },
    opened: (node: typeof a) =>
      observe([{ type: 'attributes', oldValue: null, target: node as unknown as Node }]),
  }
}
it('uses a manual top layer and repairs a removed host without blocking the page', () => {
  const f = fixture()
  expect(f.layer.setAttribute).toHaveBeenCalledWith('popover', 'manual')
  expect(f.isOpen()).toBe(true)
  expect(f.parent()).toBe(f.root)
  f.detach()
  f.observe()
  expect(f.parent()).toBe(f.root)
  f.doc.fullscreenElement = f.a
  f.doc.dispatchEvent(new Event('fullscreenchange'))
  expect(f.parent()).toBe(f.a)
  f.remove()
  expect(f.isOpen()).toBe(false)
  expect(f.disconnect).toHaveBeenCalledOnce()
  f.doc.dispatchEvent(new Event('fullscreenchange'))
  expect(f.isOpen()).toBe(false)
})
it('uses the active existing modal instead of the last modal in document order', () => {
  const f = fixture(['a', 'b'], 'a')
  expect(f.parent()).toBe(f.a)
  f.remove()
})
it('tracks modal opening order, including reopening, even without dialog toggle events', () => {
  const f = fixture()
  f.setDialogs([f.b])
  f.opened(f.b)
  expect(f.parent()).toBe(f.b)
  // DOM 顺序为 a,b，但 a 比 b 后打开，所以 a 才是顶层。
  f.setDialogs([f.a, f.b])
  f.opened(f.a)
  expect(f.parent()).toBe(f.a)
  // 关闭顶层后回到 b，重新打开 a 后再次跟随 a。
  f.setDialogs([f.b])
  f.observe()
  expect(f.parent()).toBe(f.b)
  f.setDialogs([f.a, f.b])
  f.opened(f.a)
  expect(f.parent()).toBe(f.a)
  f.setDialogs([])
  f.observe()
  expect(f.parent()).toBe(f.root)
  f.remove()
})

it('ignores open changes on details inside a lower modal', () => {
  const f = fixture(['a', 'b'], 'b')
  f.observe([
    {
      type: 'attributes',
      oldValue: null,
      target: { matches: () => false, closest: () => f.a } as unknown as Node,
    },
  ])
  expect(f.parent()).toBe(f.b)
  f.remove()
})
