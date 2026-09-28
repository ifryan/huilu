import type { ProviderSettings } from './provider-settings'

/** 离屏文档没有 chrome.storage / chrome.permissions，由后台读取后随消息传入 */
export interface ProcessingSettings {
  transcription: ProviderSettings
  llm: ProviderSettings
}
