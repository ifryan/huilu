import { defineExtensionMessaging } from '@webext-core/messaging'
import type { Meeting, RecordingMode } from '@huilu/core'
import type { EnqueueResult } from '@huilu/pipeline/jobs'
import type {
  FinishedRecording,
  RecorderStatus,
  RecordingOptions,
  UnfinishedRecording,
} from '@huilu/recorder'
import type { ProcessingSettings } from './processing-settings'
import type { RecordingPrefs } from './settings'

export type { RecorderStatus, UnfinishedRecording }

export type LastRecording = NonNullable<RecorderStatus['lastResult']>

/** 开始录制时使用的设置 */
export interface RecordingSettingsSnapshot {
  mode: RecordingMode
  prefs: RecordingPrefs
}

/**
 * 弹窗 / 快捷键请求开始录制。弹窗带上界面当前显示的设置快照（不依赖尚未完成的 storage 读写）；
 * 快捷键没有界面，settings 为空，由后台读取已保存的设置。
 */
export interface StartRecordingRequest {
  tabId: number
  title: string
  settings?: RecordingSettingsSnapshot
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
  /** 在指定标签页显示页面内悬浮录制面板；页面不允许注入（如 chrome:// 页面）时返回 false */
  showRecordingPanel(tabId: number): boolean
  /** 用户关掉了最近一次的结果 / 开始失败提示（弹窗「知道了」、悬浮面板 ✕） */
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

  // 后台 → 录制窗口（窗口 / 屏幕录制）：选择框和录制都在这个可见页面里进行
  'window:start'(options: WindowRecordingOptions): RecorderStatus
  'window:pause'(): RecorderStatus
  'window:resume'(): RecorderStatus
  'window:stop'(): RecorderStatus
  'window:status'(): RecorderStatus
  // 录制窗口 → 后台：页面已加载、消息处理已注册
  recorderWindowReady(): void

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
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
