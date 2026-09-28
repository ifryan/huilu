import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LlmProvider, TaskContext } from '@huilu/core'
import { APICallError, NoObjectGeneratedError, Output, generateText } from 'ai'
import { z } from 'zod'
import { httpUrl, requireKeyForPresets } from '../config-fields'
import { ProviderError, httpError, parseRetryAfter } from '../errors'
import { trimBaseUrl } from '../http'
import { testOpenAiCompatible } from '../openai-compatible'
import type { WithPresets } from '../presets'

export const OpenAiCompatibleLlmConfig = z
  .object({
    preset: z
      .enum(['qwen', 'deepseek', 'zhipu', 'glmCodingPlan', 'openai', 'ollama', 'custom'])
      .default('qwen')
      .meta({ titleKey: 'providers.field.preset', optionKeyPrefix: 'providers.preset' }),
    baseUrl: httpUrl().meta({
      titleKey: 'providers.field.baseUrl',
      placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    }),
    // Ollama、自定义地址可以不填；通义千问 / DeepSeek / 智谱 / OpenAI 必须填
    apiKey: z.string().trim().optional().meta({ titleKey: 'providers.field.apiKey', secret: true }),
    model: z.string().trim().min(1).meta({ titleKey: 'providers.field.model' }),
    // 实验：GLM Coding Plan 的工具请求头适配（由插件的 declarativeNetRequest 规则添加，见 apps/extension/lib/coding-plan）。
    // 不设默认值，免得其他预设的配置里多出这个字段；未填按「开启」处理，与表单 select 显示的第一项一致
    clientHeaders: z
      .enum(['claudeCli', 'off'])
      .optional()
      .meta({
        titleKey: 'providers.field.clientHeaders',
        hintKey: 'providers.field.clientHeadersHint',
        optionKeyPrefix: 'providers.clientHeaders',
        presets: ['glmCodingPlan'],
      }),
  })
  .superRefine(requireKeyForPresets(['qwen', 'deepseek', 'zhipu', 'glmCodingPlan', 'openai']))
export type OpenAiCompatibleLlmConfig = z.infer<typeof OpenAiCompatibleLlmConfig>

/** 智谱开放平台普通 API（按量计费 / 资源包） */
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
/** 智谱 GLM Coding Plan 专用的 OpenAI 兼容端点（与普通 API 不同，额度只在官方支持的工具中可用） */
export const GLM_CODING_PLAN_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'

/** 60 分钟会议的逐字稿约 2 万 token，生成纪要可能要一两分钟 */
const GENERATE_TIMEOUT_MS = 5 * 60_000

/**
 * 各家对 json_schema（Structured Outputs）的支持参差不齐（DeepSeek、部分千问模型、Ollama 旧版只有 json_object），
 * 统一用 json_object 模式，并把 JSON Schema 写进系统提示；返回结果仍由 zod schema 严格校验
 */
function jsonInstruction(schema: z.ZodType): string {
  const json = JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }))
  return [
    'Respond with a single JSON object only (no Markdown code fences, no extra text).',
    `It must conform to this JSON Schema: ${json}`,
  ].join('\n')
}

/** AI SDK 的错误 → ProviderError，设置页 / 处理任务据此给出明确原因 */
export function toProviderError(e: unknown, ctx: Pick<TaskContext, 'signal'>): ProviderError {
  if (e instanceof ProviderError) return e
  if (ctx.signal.aborted) return new ProviderError('aborted')
  if (APICallError.isInstance(e)) {
    if (e.statusCode === undefined) return new ProviderError('network', e.message)
    // 与 fetch 路径同一套分类：结构化业务错误码（如智谱 1113 欠费）优先于状态码
    return httpError(
      e.statusCode,
      e.responseBody ?? e.message,
      parseRetryAfter(e.responseHeaders?.['retry-after'] ?? null),
    )
  }
  if (NoObjectGeneratedError.isInstance(e)) {
    return new ProviderError('badResponse', (e.text ?? e.message).slice(0, 300))
  }
  if (e instanceof DOMException && e.name === 'TimeoutError') return new ProviderError('timeout')
  if (e instanceof Error && e.name === 'TimeoutError') return new ProviderError('timeout')
  return new ProviderError('network', e instanceof Error ? e.message : String(e))
}

/** 任意 OpenAI 兼容的大模型接口：通义千问、DeepSeek、智谱、OpenAI、Ollama …… */
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
    // 智谱普通 API（按量计费 / 资源包）与 GLM Coding Plan 专用端点分开：不自动迁移，不互相回退。
    // 模型名随套餐与版本变化，不预填，由用户按服务商文档填写
    {
      id: 'zhipu',
      nameKey: 'providers.preset.zhipu',
      values: { baseUrl: ZHIPU_BASE_URL, model: '' },
      hintKey: 'providers.preset.zhipuHint',
    },
    {
      id: 'glmCodingPlan',
      nameKey: 'providers.preset.glmCodingPlan',
      values: { baseUrl: GLM_CODING_PLAN_BASE_URL, model: '', clientHeaders: 'claudeCli' },
      hintKey: 'providers.preset.glmCodingPlanHint',
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
  async generateObject({ system, prompt, schema }, config, ctx) {
    const provider = createOpenAICompatible({
      name: 'huilu-llm',
      baseURL: trimBaseUrl(config.baseUrl),
      apiKey: config.apiKey || undefined,
      supportsStructuredOutputs: false,
    })
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(GENERATE_TIMEOUT_MS)])
    ctx.onProgress?.(0)
    try {
      const { output } = await generateText({
        model: provider.chatModel(config.model),
        system: `${system}\n\n${jsonInstruction(schema)}`,
        prompt,
        // 只要求 JSON（json_object），不把 schema 交给 SDK：兼容接口多数不支持 json_schema，校验在下面做
        output: Output.json(),
        temperature: 0.2,
        // 重试由处理管线统一负责（带退避、断点），这里不重复
        maxRetries: 0,
        abortSignal: signal,
      })
      const parsed = schema.safeParse(output)
      if (!parsed.success) {
        throw new ProviderError('badResponse', z.prettifyError(parsed.error).slice(0, 300))
      }
      ctx.onProgress?.(1)
      return parsed.data
    } catch (e) {
      throw toProviderError(e, ctx)
    }
  },
}
