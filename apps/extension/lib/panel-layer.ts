/**
 * 非模态 manual popover 进入浏览器 top layer，越过宿主页的 stacking context。
 * 背景不接收指针；只有面板自身可交互。不会锁滚动或把网页设为 inert。
 */
export function installPanelLayer(host: HTMLElement, layer: HTMLElement): () => void {
  layer.className = 'huilu-panel-layer'
  layer.setAttribute('popover', 'manual')
  const supported = typeof layer.showPopover === 'function'
  if (!supported) layer.removeAttribute('popover')
  let disposed = false
  const raise = () => {
    if (!supported || disposed || !layer.isConnected) return
    if (layer.matches(':popover-open')) layer.hidePopover()
    layer.showPopover()
  }
  const attach = () => {
    if (disposed) return
    // 模态 dialog 外的内容会变为 inert；把宿主移入当前对话框以保留控制能力。
    const dialogs = document.querySelectorAll('dialog:modal')
    const parent =
      dialogs.item(dialogs.length - 1) ?? document.fullscreenElement ?? document.documentElement
    if (host.parentElement !== parent) {
      parent.append(host)
      raise()
    }
  }
  const onToggle = (event: Event) => {
    if (event.composedPath().includes(host)) return
    attach()
    if ((event as ToggleEvent).newState === 'open') raise()
  }
  const onFullscreen = () => {
    attach()
    raise()
  }
  document.addEventListener('toggle', onToggle, true)
  document.addEventListener('fullscreenchange', onFullscreen)
  const observer = new MutationObserver(attach)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  })
  attach()
  raise()
  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('toggle', onToggle, true)
    document.removeEventListener('fullscreenchange', onFullscreen)
    if (supported && layer.matches(':popover-open')) layer.hidePopover()
  }
}
