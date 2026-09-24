import { defineExtensionMessaging } from '@webext-core/messaging'
import type { Meeting } from '@huilu/core'
import type {
  FinishedRecording,
  RecorderStatus,
  RecordingOptions,
  UnfinishedRecording,
} from '@huilu/recorder'

export type { RecorderStatus, UnfinishedRecording }

export type LastRecording = NonNullable<RecorderStatus['lastResult']>

/** 弹窗 / 快捷键请求开始录制：录制设置由后台从 chrome.storage 读取，两个入口行为一致 */
export interface StartRecordingRequest {
  tabId: number
  title: string
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
  /** startError：最近一次开始录制失败的原因（快捷键、窗口选择框等弹窗已关闭的场景由侧边栏显示） */
  getRecorderStatus(): RecorderStatus & { startError?: string }
  startRecording(request: StartRecordingRequest): RecorderStatus
  pauseRecording(): RecorderStatus
  resumeRecording(): RecorderStatus
  stopRecording(): RecorderStatus
  listUnfinishedRecordings(): UnfinishedRecording[]
  recoverRecording(id: string): { saved: boolean }
  discardRecording(id: string): void
  openApp(route: string): void

  // 后台 → 离屏文档
  'offscreen:start'(options: Omit<RecordingOptions, 'id'>): RecorderStatus
  'offscreen:pause'(): RecorderStatus
  'offscreen:resume'(): RecorderStatus
  'offscreen:stop'(): RecorderStatus
  'offscreen:status'(): RecorderStatus
  'offscreen:listUnfinished'(): UnfinishedRecording[]
  'offscreen:recover'(id: string): Meeting | null
  'offscreen:discard'(id: string): void

  // 离屏文档 → 后台：录制结束（用户结束 / 来源结束 / 写入失败）
  recordingFinished(result: Omit<FinishedRecording, 'meeting'> & { saved: boolean }): void
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
