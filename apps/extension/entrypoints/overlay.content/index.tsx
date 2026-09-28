// 样式编译进脚本，放入封闭 Shadow DOM；不向宿主网页暴露 CSS 文件。
import css from './style.css?inline'
import { createShadowRootUi, defineContentScript } from '#imports'
import { RecordingPanel } from '@/components/recording/RecordingPanel'
import { onExtensionContextInvalidated, reportPanelError } from '@/lib/extension-context'
import { mountInto } from '@/lib/mount'
import { installPanelLayer } from '@/lib/panel-layer'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',
  async main(ctx) {
    const removeErrorHandler = onExtensionContextInvalidated(() => ctx.notifyInvalidated())
    ctx.onInvalidated(removeErrorHandler)
    try {
      const ui = await createShadowRootUi(ctx, {
        name: 'huilu-recording-panel',
        css,
        mode: 'closed',
        position: 'inline',
        anchor: () => document.documentElement,
        isolateEvents: true,
        onMount: (container, _shadow, host) => {
          const layer = document.createElement('div')
          container.append(layer)
          const removeLayer = installPanelLayer(host, layer)
          const mounted = mountInto(layer, <RecordingPanel />)
          void mounted.ready.catch(reportPanelError)
          return {
            unmount() {
              mounted.unmount()
              removeLayer()
            },
          }
        },
        // WXT 接着就会清空容器，不能在这里先 await 或 .then。
        onRemove: (mounted) => mounted?.unmount(),
      })
      // 异步创建期间另一次注入可能已使本实例失效。
      if (ctx.isInvalid) return
      ui.mount()
      // WXT 只在读取 isValid 时检查 runtime.id；即使面板关闭也要回收旧上下文。
      ctx.setInterval(() => {}, 1000)
      ctx.addEventListener(window, 'pagehide', () => ctx.notifyInvalidated())
    } catch (error) {
      reportPanelError(error)
      ctx.notifyInvalidated()
    }
  },
})
