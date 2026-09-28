/**
 * 页面内的悬浮录制面板（代替 Chrome 侧边栏）：固定定位、画在网页之上，不改变网页布局。
 * 不在 manifest 里声明、也不申请「所有网站」权限：后台在用户点击弹窗 / 按快捷键后
 * 借 activeTab 用 scripting.executeScript 注入到当前标签页。重复注入会替换旧面板（即重新显示）。
 */
// 样式编译进脚本、直接放进 Shadow DOM：不把 CSS 文件暴露给网页（web_accessible_resources）
import css from './style.css?inline'
import { createShadowRootUi, defineContentScript } from '#imports'
import { RecordingPanel } from '@/components/recording/RecordingPanel'
import { mountInto } from '@/lib/mount'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',
  async main(ctx) {
    // 每次注入都是新实例：WXT 会让上一个实例失效并移除它的界面，所以这里总是重新挂载（即重新显示面板）
    const ui = await createShadowRootUi(ctx, {
      name: 'huilu-recording-panel',
      css,
      position: 'overlay',
      zIndex: 2147483647,
      // 面板内的输入不要触发网页的快捷键
      isolateEvents: true,
      onMount: (container) => mountInto(container, <RecordingPanel />),
      // 移除面板（关闭或被重新注入替换）时一并释放语言监听
      onRemove: (mounted) => void mounted?.then((m) => m.unmount()),
    })
    ui.mount()
  },
})
