import type { TaskContext } from '@huilu/core'
import { ProviderError } from './errors'
import { bearer, fetchJson, trimBaseUrl } from './http'

export interface OpenAiCompatibleConnection {
  baseUrl: string
  apiKey?: string
  model: string
}

/**
 * OpenAI 兼容接口的连接测试：GET {baseUrl}/models。
 * 该接口不计费，能同时验证 Base URL、Key，以及所填模型是否可用。
 */
export async function testOpenAiCompatible(
  { baseUrl, apiKey, model }: OpenAiCompatibleConnection,
  ctx: TaskContext,
): Promise<void> {
  const body = await fetchJson<{ data?: { id?: unknown }[] }>(
    `${trimBaseUrl(baseUrl)}/models`,
    { headers: bearer(apiKey) },
    ctx,
  )
  if (!Array.isArray(body.data)) {
    throw new ProviderError('badResponse', JSON.stringify(body).slice(0, 300))
  }
  const ids = body.data.map((m) => m.id).filter((id): id is string => typeof id === 'string')
  if (!ids.includes(model.trim())) {
    throw new ProviderError('modelNotFound', ids.slice(0, 8).join(', '))
  }
}
