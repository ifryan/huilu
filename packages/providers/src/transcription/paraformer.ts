import type { TranscriptionProvider } from '@huilu/core'
import { z } from 'zod'
import { ProviderError } from '../errors'
import { bearer, fetchJson } from '../http'

export const DASHSCOPE_ENDPOINTS = {
  cn: 'https://dashscope.aliyuncs.com',
  intl: 'https://dashscope-intl.aliyuncs.com',
} as const

export const ParaformerConfig = z.object({
  region: z
    .enum(['cn', 'intl'])
    .default('cn')
    .meta({ titleKey: 'providers.field.region', optionKeyPrefix: 'providers.region' }),
  apiKey: z.string().trim().min(1).meta({ titleKey: 'providers.field.apiKey', secret: true }),
  model: z
    .string()
    .trim()
    .min(1)
    .default('paraformer-v2')
    .meta({ titleKey: 'providers.field.model' }),
})
export type ParaformerConfig = z.infer<typeof ParaformerConfig>

/** 阿里云百炼 Paraformer 录音文件识别（默认推荐，支持区分发言人） */
export const paraformer: TranscriptionProvider<ParaformerConfig> = {
  id: 'dashscope-paraformer',
  nameKey: 'providers.paraformer.name',
  configSchema: ParaformerConfig,
  capabilities: {
    diarization: true,
    languages: ['zh', 'en', 'ja', 'ko', 'yue'],
  },
  /**
   * 申请一次临时上传凭证（getPolicy）：不上传文件、不计费，
   * 能验证 Key、地域和模型名（凭证与模型绑定）。
   */
  async testConnection({ region, apiKey, model }, ctx) {
    const body = await fetchJson<{ data?: { upload_host?: unknown } }>(
      `${DASHSCOPE_ENDPOINTS[region]}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
      { headers: bearer(apiKey) },
      ctx,
    )
    if (typeof body.data?.upload_host !== 'string') {
      throw new ProviderError('badResponse', JSON.stringify(body).slice(0, 300))
    }
  },
  // 实际转写在「转写与纪要」子任务中实现（参考 spikes/extension/lib/dashscope.js）
  transcribe: () => Promise.reject(new ProviderError('notImplemented')),
}
