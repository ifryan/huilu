import type { LlmProvider } from '@huilu/core'
import { z } from 'zod'
import { httpUrl } from '../config-fields'
import { ProviderError } from '../errors'
import { testOpenAiCompatible } from '../openai-compatible'
import type { WithPresets } from '../presets'

export const OpenAiCompatibleLlmConfig = z.object({
  preset: z
    .enum(['qwen', 'deepseek', 'openai', 'ollama', 'custom'])
    .default('qwen')
    .meta({ titleKey: 'providers.field.preset', optionKeyPrefix: 'providers.preset' }),
  baseUrl: httpUrl().meta({
    titleKey: 'providers.field.baseUrl',
    placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  }),
  // Ollama 等本地服务不需要 Key
  apiKey: z.string().trim().optional().meta({ titleKey: 'providers.field.apiKey', secret: true }),
  model: z.string().trim().min(1).meta({ titleKey: 'providers.field.model' }),
})
export type OpenAiCompatibleLlmConfig = z.infer<typeof OpenAiCompatibleLlmConfig>

/** 任意 OpenAI 兼容的大模型接口：通义千问、DeepSeek、OpenAI、Ollama …… */
export const openAiCompatibleLlm: LlmProvider<OpenAiCompatibleLlmConfig> & WithPresets = {
  id: 'openai-compatible',
  nameKey: 'providers.openaiCompatibleLlm.name',
  configSchema: OpenAiCompatibleLlmConfig,
  presets: [
    {
      id: 'qwen',
      nameKey: 'providers.preset.qwen',
      values: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    },
    {
      id: 'deepseek',
      nameKey: 'providers.preset.deepseek',
      values: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    },
    {
      id: 'openai',
      nameKey: 'providers.preset.openai',
      values: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    },
    {
      id: 'ollama',
      nameKey: 'providers.preset.ollama',
      values: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
      hintKey: 'providers.preset.ollamaHint',
    },
    { id: 'custom', nameKey: 'providers.preset.custom', values: {} },
  ],
  testConnection: (config, ctx) => testOpenAiCompatible(config, ctx),
  // 实际生成在「转写与纪要」子任务中实现（Vercel AI SDK）
  generateObject: () => Promise.reject(new ProviderError('notImplemented')),
}
