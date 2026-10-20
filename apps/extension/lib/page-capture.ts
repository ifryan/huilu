/**
 * 页面内录制的内容脚本（entrypoints/capture.content）与录制面板（entrypoints/overlay.content）
 * 注入在同一个网页、同一个插件隔离环境里，共用 globalThis。getDisplayMedia 必须在网页内点击的
 * 同步调用栈里调用，所以面板上的「选择来源」直接调这里登记的函数，不能绕道后台消息。
 */
export interface PageCaptureControls {
  /** 在点击处理函数里同步调用：弹出选择框并开始录制，结果由内容脚本报告给后台 */
  chooseSource(): void
  /** 放弃这次录制（面板上的「取消」） */
  cancel(): void
}

const KEY = '__huiluPageCapture'

type Scope = typeof globalThis & { [KEY]?: PageCaptureControls }

export function registerPageCapture(controls: PageCaptureControls) {
  ;(globalThis as Scope)[KEY] = controls
}

export function pageCapture(): PageCaptureControls | undefined {
  return (globalThis as Scope)[KEY]
}
