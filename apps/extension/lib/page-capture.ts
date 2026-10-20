import type { StartRecordingRequest } from './messaging'

/**
 * 页面内录制的内容脚本（entrypoints/capture.content）与录制面板（entrypoints/overlay.content）
 * 注入在同一个网页、同一个插件隔离环境里，共用 globalThis。getDisplayMedia 必须在网页内点击的
 * 同步调用栈里调用，所以面板上的「选择来源」直接调这里登记的函数，不能绕道后台消息。
 */
export interface PageCaptureControls {
  /** 在点击处理函数里同步调用：弹出选择框并开始录制，结果由内容脚本报告给后台 */
  chooseSource(): void
  /**
   * 网页面板上的「选择来源并开始」：在点击里同步弹出选择框，同时请后台准备录制；
   * 选好来源、录制开始后完成。失败原因由内容脚本报给后台
   */
  startWithPicker(request: Omit<StartRecordingRequest, 'tabId' | 'pagePicker'>): Promise<void>
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

/**
 * 点插件图标打开的是设置面板（setup）：没在录制时显示录制设置，录完回到设置；
 * 开始录制后 / 快捷键注入的是录制面板（recording）：录制结束就收起。
 * 后台注入面板前用 executeScript 写进隔离环境，面板加载时取走
 */
export type PanelView = 'setup' | 'recording'
export const PANEL_VIEW_KEY = '__huiluPanelView'

export function takePanelView(): PanelView {
  const scope = globalThis as typeof globalThis & { [PANEL_VIEW_KEY]?: PanelView }
  const view = scope[PANEL_VIEW_KEY] ?? 'recording'
  delete scope[PANEL_VIEW_KEY]
  return view
}

/** 退路弹窗连到后台的端口名 */
export const POPUP_PORT = 'huilu-popup'
