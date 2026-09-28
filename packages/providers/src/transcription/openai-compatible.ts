import type { TranscriptionProvider } from '@huilu/core'
import { z } from 'zod'
import { httpUrl, requireKeyForPresets } from '../config-fields'
import { ProviderError } from '../errors'
import { testOpenAiCompatible } from '../openai-compatible'
import type { WithPresets } from '../presets'

export const OpenAiCompatibleTranscriptionConfig = z
  .object({
    preset: z
      .enum(['groq', 'openai', 'custom'])
      .default('groq')
      .meta({ titleKey: 'providers.field.preset', optionKeyPrefix: 'providers.preset' }),
    baseUrl: httpUrl().meta({
      titleKey: 'providers.field.baseUrl',
      placeholder: 'https://api.groq.com/openai/v1',
    }),
    // 自定义地址可以不填；Groq / OpenAI 必须填
    apiKey: z.string().trim().optional().meta({ titleKey: 'providers.field.apiKey', secret: true }),
    model: z.string().trim().min(1).meta({ titleKey: 'providers.field.model' }),
  })
  .superRefine(requireKeyForPresets(['groq', 'openai']))
export type OpenAiCompatibleTranscriptionConfig = z.infer<
  typeof OpenAiCompatibleTranscriptionConfig
>

/** OpenAI 兼容转写接口（/audio/transcriptions），内置 Groq / OpenAI 预设 */
export const openAiCompatibleTranscription: TranscriptionProvider<OpenAiCompatibleTranscriptionConfig> &
  WithPresets = {
  id: 'openai-compatible',
  nameKey: 'providers.openaiCompatibleTranscription.name',
  configSchema: OpenAiCompatibleTranscriptionConfig,
  capabilities: {
    diarization: false,
    maxFileBytes: 25 * 2 ** 20,
    languages: ['zh', 'en'],
  },
  presets: [
    {
      id: 'groq',
      nameKey: 'providers.preset.groq',
      values: { baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
    },
    {
      id: 'openai',
      nameKey: 'providers.preset.openai',
      values: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
    },
    { id: 'custom', nameKey: 'providers.preset.custom', values: {} },
  ],
  testConnection: (config, ctx) => testOpenAiCompatible(config, ctx),
  // 实际转写在「转写与纪要」子任务中实现（参考 spikes/extension/lib/openai-compatible.js）
  transcribe: () => Promise.reject(new ProviderError('notImplemented')),
}
