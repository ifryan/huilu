import { ProviderError } from './errors'
import { getPresets } from './presets'
export type BrowserCors = 'ok' | 'blocked' | 'unknown'
export interface BrowserCapability {
  browserCors?: BrowserCors
}

/** A preset only describes its default endpoint, not a user-supplied gateway. */
export function browserCors(
  provider: object & BrowserCapability,
  config: Record<string, unknown>,
): BrowserCors {
  if (config.preset === 'glmCodingPlan') return 'blocked'
  try {
    if (
      typeof config.baseUrl === 'string' &&
      new URL(config.baseUrl).pathname.includes('/api/coding/')
    )
      return 'blocked'
  } catch {
    /* Incomplete form URL. */
  }
  const preset = getPresets(provider).find((p) => p.id === config.preset)
  if (
    preset?.values.baseUrl &&
    preset.values.baseUrl.replace(/\/+$/, '') !== String(config.baseUrl).replace(/\/+$/, '')
  )
    return 'unknown'
  return preset?.browserCors ?? provider.browserCors ?? 'unknown'
}

/** Fetch intentionally hides CORS/DNS/TLS details: this classification is a likely cause, not proof. */
export function browserRequestError(error: unknown, online = navigator.onLine): unknown {
  if (!online) return error
  if (
    (error instanceof ProviderError && error.code === 'network') ||
    (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
  ) {
    return new ProviderError('cors')
  }
  return error
}
export async function browserRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    throw browserRequestError(error)
  }
}
