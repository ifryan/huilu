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
  const modals = () => Array.from(document.querySelectorAll<HTMLElement>('dialog:modal'))
  let modalOrder = modals()
  const rememberModal = (element: Element | null | undefined) => {
    if (element?.matches?.('dialog:modal')) {
      const dialog = element as HTMLElement
      modalOrder = [...modalOrder.filter((item) => item !== dialog), dialog]
    }
  }
  // 注入前已打开的模态框：焦点和命中测试反映当前最上层，DOM 顺序不代表打开顺序。
  rememberModal(document.elementFromPoint?.(0, 0)?.closest('dialog:modal'))
  rememberModal(document.activeElement?.closest('dialog:modal'))
  const raise = () => {
    if (!supported || disposed || !layer.isConnected) return
    if (layer.matches(':popover-open')) layer.hidePopover()
    layer.showPopover()
  }
  const attach = () => {
    if (disposed) return
    const current = modals()
    modalOrder = modalOrder.filter((dialog) => current.includes(dialog))
    for (const dialog of current) if (!modalOrder.includes(dialog)) modalOrder.push(dialog)
    // 模态 dialog 外的内容会变为 inert；把宿主移入当前对话框以保留控制能力。
    const parent = modalOrder.at(-1) ?? document.fullscreenElement ?? document.documentElement
    if (host.parentElement !== parent) {
      parent.append(host)
      raise()
    }
  }
  const onToggle = (event: Event) => {
    if (event.composedPath().includes(host)) return
    if ((event as ToggleEvent).newState === 'open') rememberModal(event.target as Element)
    attach()
    if ((event as ToggleEvent).newState === 'open') raise()
  }
  const onFullscreen = () => {
    attach()
    raise()
  }
  document.addEventListener('toggle', onToggle, true)
  document.addEventListener('fullscreenchange', onFullscreen)
  const observer = new MutationObserver((records) => {
    // Chrome 122 的 dialog 尚无 toggle 事件；open 变化的记录顺序也能保存 showModal 顺序。
    for (const record of records) {
      if (record.type === 'attributes' && record.oldValue === null)
        rememberModal(record.target as Element)
    }
    attach()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
    attributeOldValue: true,
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
