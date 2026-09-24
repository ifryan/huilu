import type { LlmProvider, TranscriptionProvider, registries as coreRegistries } from '@huilu/core'
import { openAiCompatibleLlm } from './llm/openai-compatible'
import { openAiCompatibleTranscription } from './transcription/openai-compatible'
import { paraformer } from './transcription/paraformer'

export * from './errors'
export * from './config-fields'
export * from './presets'
export { fetchJson, trimBaseUrl } from './http'
export * from './transcription/paraformer'
export * from './transcription/openai-compatible'
export * from './llm/openai-compatible'

/** 内置转写服务商，第一个为默认推荐 */
export const builtinTranscriptionProviders = [paraformer, openAiCompatibleTranscription]
export const builtinLlmProviders = [openAiCompatibleLlm]

/** 把内置服务商登记到注册中心；重复调用是安全的 */
export function registerBuiltinProviders(registries: typeof coreRegistries): void {
  for (const p of builtinTranscriptionProviders) {
    if (!registries.transcription.has(p.id)) {
      registries.transcription.register(p as TranscriptionProvider)
    }
  }
  for (const p of builtinLlmProviders) {
    if (!registries.llm.has(p.id)) registries.llm.register(p as LlmProvider)
  }
}
