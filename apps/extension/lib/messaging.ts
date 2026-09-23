import { defineExtensionMessaging } from '@webext-core/messaging'
import type { RecordingMode } from '@huilu/core'

export interface RecorderStatus {
  state: 'idle' | 'recording' | 'paused'
  mode?: RecordingMode
  startedAt?: number
}

/**
 * 各运行环境（后台 / 离屏文档 / 弹窗 / 侧边栏 / 插件网页）之间的消息协议。
 * 新增消息时只需在这里加一行，发送端和接收端都会得到类型检查。
 */
interface ProtocolMap {
  getRecorderStatus(): RecorderStatus
  openApp(route: string): void
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
