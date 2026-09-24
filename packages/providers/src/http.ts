import type { TaskContext } from '@huilu/core'
import { ProviderError, statusToCode } from './errors'

export const DEFAULT_TIMEOUT_MS = 15_000

/** 去掉 Base URL 末尾的斜杠，便于拼接路径 */
export const trimBaseUrl = (url: string) => url.trim().replace(/\/+$/, '')

/** 从各家不同格式的错误响应里取出可读的说明 */
function errorDetail(body: unknown, raw: string): string | undefined {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const err = b.error
    if (
      err &&
      typeof err === 'object' &&
      typeof (err as { message?: unknown }).message === 'string'
    ) {
      return (err as { message: string }).message
    }
    if (typeof err === 'string') return err
    if (typeof b.message === 'string') return [b.code, b.message].filter(Boolean).join(': ')
    if (typeof b.code === 'string') return b.code
  }
  return raw.trim().slice(0, 300) || undefined
}

/**
 * 发请求并解析 JSON；所有失败都转换成 ProviderError。
 * 网络错误（DNS、断网、CORS / 未授予域名权限）在 fetch 中统一表现为 TypeError。
 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  ctx: Pick<TaskContext, 'signal'>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)])
  let res: Response
  try {
    res = await fetch(url, { ...init, signal })
  } catch (e) {
    if (ctx.signal.aborted) throw new ProviderError('aborted')
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ProviderError('timeout')
    throw new ProviderError('network', e instanceof Error ? e.message : String(e))
  }

  const raw = await res.text()
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    body = undefined
  }
  if (!res.ok) {
    throw new ProviderError(statusToCode(res.status), errorDetail(body, raw), res.status)
  }
  if (body === undefined) throw new ProviderError('badResponse', raw.slice(0, 300), res.status)
  return body as T
}

export const bearer = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey.trim()}` } : {}
