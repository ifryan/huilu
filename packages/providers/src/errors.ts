/** 连接 / 调用失败的原因分类，设置页据此给出「明确的失败原因」（i18n：providers.error.<code>） */
export const PROVIDER_ERROR_CODES = [
  'invalidConfig',
  'unauthorized',
  'forbidden',
  'notFound',
  'modelNotFound',
  'badRequest',
  'rateLimited',
  'server',
  'network',
  'timeout',
  'aborted',
  'badResponse',
  'notImplemented',
] as const
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]

export class ProviderError extends Error {
  override name = 'ProviderError'
  constructor(
    readonly code: ProviderErrorCode,
    /** 服务商返回的原始说明（不含 Key），直接展示给用户 */
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export function statusToCode(status: number): ProviderErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 429) return 'rateLimited'
  if (status >= 500) return 'server'
  return 'badRequest'
}
