// 服务商设置的数据结构与默认值。单独成文件、不引入服务商实现，避免把 zod 等打进后台脚本

export interface ProviderSettings {
  providerId: string
  /** 只有点过「保存」的服务商才会出现在这里 */
  configs: Record<string, Record<string, unknown>>
}

/** 默认推荐百炼 Paraformer */
export const DEFAULT_TRANSCRIPTION_SETTINGS: ProviderSettings = {
  providerId: 'dashscope-paraformer',
  configs: {},
}
export const DEFAULT_LLM_SETTINGS: ProviderSettings = {
  providerId: 'openai-compatible',
  configs: {},
}
