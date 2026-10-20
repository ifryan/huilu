import { defineExtensionMessaging } from '@webext-core/messaging'
import type { Meeting, RecordingMode } from '@huilu/core'
import type { EnqueueResult } from '@huilu/pipeline/jobs'
import type {
  FinishedRecording,
  RecorderStatus as BaseRecorderStatus,
  RecordingOptions,
  UnfinishedRecording,
} from '@huilu/recorder'
import type { FolderStatus } from '@huilu/storage'
import type { ProcessingSettings } from './processing-settings'
import type { Readiness } from './readiness-check'
import type { RecordingPrefs } from './settings'

export type { UnfinishedRecording }

/**
 * 录制状态。awaitingSource：页面内录制已就绪，正等用户在网页的录制面板上点「选择来源」
 * （getDisplayMedia 要求网页内的点击），此时 state 为 starting、还没有 session
 */
export type RecorderStatus = BaseRecorderStatus & { awaitingSource?: boolean }

export type LastRecording = NonNullable<RecorderStatus['lastResult']>

/** 开始录制时使用的设置 */
export interface RecordingSettingsSnapshot {
  mode: RecordingMode
  prefs: RecordingPrefs
}

/**
 * 网页面板 / 弹窗 / 快捷键请求开始录制。界面带上当前显示的设置快照（不依赖尚未完成的 storage 读写）；
 * 快捷键没有界面，settings 为空，由后台读取已保存的设置。
 */
export interface StartRecordingRequest {
  /** 要录的标签页；网页面板发来的请求不带，后台用发送方所在的标签页 */
  tabId?: number
  title: string
  settings?: RecordingSettingsSnapshot
  /**
   * 网页面板已在点击里直接弹出共享选择框（getDisplayMedia）：后台只在该网页里准备录制，
   * 不退回采集标签页，也不再让用户点一次「选择来源」
   */
  pagePicker?: boolean
}

/**
 * 各运行环境（后台 / 离屏文档 / 弹窗 / 侧边栏 / 插件网页）之间的消息协议。
 * 新增消息时只需在这里加一行，发送端和接收端都会得到类型检查。
 *
 * runtime.sendMessage 会广播给所有插件页面，同一类型只能由一个环境处理：
 * 界面 → 后台用普通名称，后台 → 离屏文档统一加 `offscreen:` 前缀。
 */
interface ProtocolMap {
  // 界面 → 后台
  /**
   * lastResult / startError：最近一次录制结果、开始录制失败的原因，直到用户关掉提示或开始新的录制。
   * 悬浮面板和弹窗（面板无法显示时）都据此提示，快捷键结束、面板重新注入后也不会丢。
   */
  getRecorderStatus(): RecorderStatus & { startError?: string }
  /** panelShown：悬浮录制面板是否已显示在该标签页；为 false 时弹窗保留，改在弹窗里控制 */
  startRecording(request: StartRecordingRequest): RecorderStatus & { panelShown: boolean }
  pauseRecording(): RecorderStatus
  resumeRecording(): RecorderStatus
  stopRecording(): RecorderStatus
  listUnfinishedRecordings(): UnfinishedRecording[]
  recoverRecording(id: string): { saved: boolean }
  discardRecording(id: string): void
  openApp(route: string): void
  /** 网页面板里的就绪状态：内容脚本读不到插件的文件夹句柄和域名权限，由后台 / 离屏文档查询 */
  getReadiness(): Readiness
  /** 插件自己的麦克风授权状态（网页面板里 navigator.permissions 查到的是网页的） */
  getMicrophonePermission(): PermissionState | 'unknown'
  /** 用户关掉了最近一次的结果 / 开始失败提示（「知道了」） */
  dismissRecordingNotice(): void
  /** 历史记录中的「补转写」「重试」「生成纪要」：加入处理队列 */
  processMeeting(meetingId: string): EnqueueResult

  // 后台 → 离屏文档（标签页录制）
  'offscreen:start'(options: Omit<RecordingOptions, 'id'>): RecorderStatus
  'offscreen:pause'(): RecorderStatus
  'offscreen:resume'(): RecorderStatus
  'offscreen:stop'(): RecorderStatus
  'offscreen:status'(): RecorderStatus
  'offscreen:listUnfinished'(): UnfinishedRecording[]
  'offscreen:recover'(id: string): Meeting | null
  'offscreen:discard'(id: string): void
  /**
   * 会后处理：meetingId 为空时只唤醒队列（浏览器重启后继续）；auto 为录制结束后的自动加入。
   * 离屏文档刚创建时队列会自行恢复中断的任务
   */
  'offscreen:process'(request: { meetingId?: string; auto?: boolean }): EnqueueResult | null
  /** 是否还有排队 / 执行中的处理任务：有就不能关闭离屏文档 */
  'offscreen:processingBusy'(): boolean
  /** 数据文件夹重新授权：补写等待写入的任务 */
  'offscreen:folderAuthorized'(): void
  /** 数据文件夹授权状态、插件的麦克风授权状态（只有插件页面能查） */
  'offscreen:folderStatus'(): FolderStatus
  'offscreen:microphonePermission'(): PermissionState | 'unknown'

  // 后台 → 录制窗口（统一来源选择；兼容旧窗口 / 屏幕录制）：选择框和录制都在这个可见页面里进行
  'window:start'(options: WindowRecordingOptions): RecorderStatus
  'window:pause'(): RecorderStatus
  'window:resume'(): RecorderStatus
  'window:stop'(): RecorderStatus
  'window:status'(): RecorderStatus
  // 录制窗口 → 后台：页面已加载、消息处理已注册
  recorderWindowReady(): void

  // 后台 → 网页（页面内录制，entrypoints/capture.content）：按 tabId 发送，选择框由后台在该网页上弹出
  /** 嵌入存储 iframe 并等它就绪；网页里已有录制时返回 false */
  'page:prepare'(sinkToken: string): boolean
  /** 选择框被取消等：移除空闲的存储 iframe */
  'page:release'(): void
  /** 记下录制设置，在录制面板上等用户点「选择来源」；之后的结果由网页用 page* 消息报告 */
  'page:arm'(options: WindowRecordingOptions): RecorderStatus
  'page:pause'(): RecorderStatus
  'page:resume'(): RecorderStatus
  'page:stop'(): RecorderStatus
  'page:status'(): RecorderStatus
  // 网页 → 后台：页面内录制在用户选源后开始成功 / 失败（含取消、等待超时）
  pageRecordingStarted(status: RecorderStatus): void
  pageRecordingFailed(error: string): void
  // 存储 iframe → 后台：核对 page:prepare 时下发的一次性令牌，防止网页自己嵌入它来写插件存储
  verifyRecorderSink(token: string): boolean

  // 离屏文档 → 后台：录制结束（用户结束 / 来源结束 / 写入失败）
  recordingFinished(result: Omit<FinishedRecording, 'meeting'> & { saved: boolean }): void
  // 离屏文档 → 后台：处理管线需要的平台能力（离屏文档只有 chrome.runtime）
  /** 当前的转写 / 大模型设置（含 Key，只在插件内部传递，不写入任何文件） */
  processingSettings(): ProcessingSettings
  processingHasHostPermission(url: string): boolean
  /** 处理队列已空：后台检查后关闭空闲的离屏文档 */
  processingIdle(): void
  processingCompleted(meetingId: string): void
}

/** 录制窗口自己弹选择框取得 streamId，后台只传录制设置 */
export type WindowRecordingOptions = Omit<RecordingOptions, 'id' | 'streamId' | 'sourceAudio'> & {
  sourceAudio: boolean
  /** Unified native tab/window/screen selection, resolved in the visible host. */
  chooseSource?: boolean
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
