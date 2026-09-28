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
  'fileTooLarge',
  'taskFailed',
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
    /** 429 等响应的 Retry-After，毫秒 */
    readonly retryAfterMs?: number,
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

/** 稍后重试可能成功的错误（限流、服务端错误、网络、超时、返回内容异常）；其余需要用户修改配置 */
export function isRetryable(code: ProviderErrorCode): boolean {
  return (
    code === 'rateLimited' ||
    code === 'server' ||
    code === 'network' ||
    code === 'timeout' ||
    code === 'badResponse'
  )
}

/** 解析 Retry-After（秒数或 HTTP 日期） */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}
