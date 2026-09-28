import type { TaskContext } from '@huilu/core'
import { ProviderError, parseRetryAfter, statusToCode } from './errors'

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

function parseJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/**
 * 发请求，返回状态码为 2xx 的响应及其文本；所有失败都转换成 ProviderError。
 * 网络错误（DNS、断网、CORS / 未授予域名权限）在 fetch 中统一表现为 TypeError。
 */
export async function fetchText(
  url: string,
  init: RequestInit,
  ctx: Pick<TaskContext, 'signal'>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ res: Response; raw: string }> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)])
  let res: Response
  let raw: string
  try {
    res = await fetch(url, { ...init, signal })
    raw = await res.text()
  } catch (e) {
    if (ctx.signal.aborted) throw new ProviderError('aborted')
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ProviderError('timeout')
    throw new ProviderError('network', e instanceof Error ? e.message : String(e))
  }
  if (!res.ok) {
    throw new ProviderError(
      statusToCode(res.status),
      errorDetail(parseJson(raw), raw),
      res.status,
      parseRetryAfter(res.headers.get('retry-after')),
    )
  }
  return { res, raw }
}

/** 发请求并解析 JSON；非 JSON 的成功响应视为 badResponse */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  ctx: Pick<TaskContext, 'signal'>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { res, raw } = await fetchText(url, init, ctx, timeoutMs)
  const body = parseJson(raw)
  if (body === undefined) throw new ProviderError('badResponse', raw.slice(0, 300), res.status)
  return body as T
}

export const bearer = (apiKey?: string): Record<string, string> =>
  apiKey ? { Authorization: `Bearer ${apiKey.trim()}` } : {}

/** 可取消的等待；取消时抛 ProviderError('aborted') */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderError('aborted'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ProviderError('aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 上传用的文件名：扩展名要与真实容器一致（服务端按文件名判断格式） */
export function audioFileName(mimeType: string, base = 'audio'): string {
  const [type = ''] = mimeType.split(';')
  const sub = type.trim().split('/')[1] ?? ''
  const ext =
    { mpeg: 'mp3', 'x-wav': 'wav', wave: 'wav', 'x-m4a': 'm4a', mp4: 'm4a', ogg: 'ogg' }[sub] ??
    (/^[a-z0-9]+$/.test(sub) ? sub : 'webm')
  return `${base}.${ext}`
}
