/** 连接 / 调用失败的原因分类，设置页据此给出「明确的失败原因」（i18n：providers.error.<code>） */
export const PROVIDER_ERROR_CODES = [
  'invalidConfig',
  'unauthorized',
  'forbidden',
  'notFound',
  'modelNotFound',
  'badRequest',
  'rateLimited',
  'quotaExceeded',
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
  // 402 Payment Required：DeepSeek「Insufficient Balance」等余额不足
  if (status === 402) return 'quotaExceeded'
  if (status === 403) return 'forbidden'
  if (status === 408) return 'timeout'
  if (status === 404) return 'notFound'
  if (status === 429) return 'rateLimited'
  if (status >= 500) return 'server'
  return 'badRequest'
}

/**
 * 服务商结构化错误码中明确表示「余额不足 / 欠费 / 套餐或花费上限已用尽」的：等待不会恢复，
 * 需要用户处理账户或更换服务。按官方文档逐个列出；限流和会自动重置的额度窗口不在此列：
 * - 智谱 BigModel（HTTP 429）：1113 账户欠费 / 余额不足或无可用资源包，1309 套餐已到期，1314 企业套餐已失效
 *   （1302 / 1305 / 1308 / 1310 / 1313 / 1316–1321 为限流或 5 小时 / 7 天等窗口上限，仍按限流重试）
 * - OpenAI（HTTP 429）：credit_balance_exhausted、organization/project_spend_limit_exceeded、
 *   organization_usage_limit_exceeded
 * - 阿里云百炼：Arrearage（HTTP 400，欠费）、AllocationQuota.FreeTierOnly（HTTP 403，免费额度用完）
 * 注意 insufficient_quota 不在此列：百炼用它表示 TPS / TPM 限流
 */
const QUOTA_EXCEEDED_CODES = new Set([
  '1113',
  '1309',
  '1314',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'Arrearage',
  'AllocationQuota.FreeTierOnly',
])

/** 可能包含凭据的片段（Bearer Token、sk- 开头的 Key）替换掉，错误说明会展示并持久化 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer)\s+[^\s"',}]+/gi, '$1 ***')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
}

function parseJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/** 从各家不同格式的错误响应里取出业务错误码与可读说明：{ error: { code, message } } 或 { code, message } */
export function describeErrorBody(raw: string): { code?: string; message?: string } {
  const body = parseJson(raw)
  if (!body || typeof body !== 'object') return {}
  const b = body as Record<string, unknown>
  const text = (v: unknown) =>
    typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined
  if (b.error && typeof b.error === 'object') {
    const e = b.error as Record<string, unknown>
    return { code: text(e.code), message: text(e.message) }
  }
  if (typeof b.error === 'string') return { message: b.error }
  return { code: text(b.code), message: text(b.message) }
}

/**
 * HTTP 失败响应 → ProviderError。结构化业务错误码优先于状态码：
 * 同为 429，智谱 1113（欠费）不能自动重试，1302（限流）可以。说明中去掉凭据
 */
export function httpError(status: number, raw: string, retryAfterMs?: number): ProviderError {
  const { code, message } = describeErrorBody(raw)
  const detail = message
    ? [code, message].filter(Boolean).join(': ')
    : code || raw.trim().slice(0, 300) || undefined
  return new ProviderError(
    code && QUOTA_EXCEEDED_CODES.has(code) ? 'quotaExceeded' : statusToCode(status),
    detail === undefined ? undefined : redactSecrets(detail).slice(0, 300),
    status,
    retryAfterMs,
  )
}

/**
 * 旧版本持久化的错误说明（原始响应 JSON 或「码: 说明」）是否属于明确的余额 / 额度不足。
 * 只认结构化错误码，认不出的返回 false，不改动
 */
export function isQuotaExceededDetail(detail: string | undefined): boolean {
  if (!detail) return false
  const { code } = describeErrorBody(detail.trim())
  if (code) return QUOTA_EXCEEDED_CODES.has(code)
  const prefix = /^([A-Za-z0-9_.]+):\s/.exec(detail.trim())?.[1]
  return prefix !== undefined && QUOTA_EXCEEDED_CODES.has(prefix)
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
