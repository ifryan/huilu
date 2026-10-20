import type { LlmProvider, TranscriptionProvider } from '@huilu/core'
import { browserRequest, ProviderError } from '@huilu/providers'
import * as shared from '@huilu/app-shell/lib/providers'
export * from '@huilu/app-shell/lib/providers'

export function browserProvider<P extends TranscriptionProvider | LlmProvider>(provider: P): P {
  const check = (config: unknown) => {
    const c = config as Record<string, unknown>
    if (
      c.preset === 'glmCodingPlan' ||
      (typeof c.baseUrl === 'string' && new URL(c.baseUrl).pathname.includes('/api/coding/'))
    )
      throw new ProviderError('notImplemented')
  }
  const testConnection = (config: unknown, ctx: Parameters<P['testConnection']>[1]) =>
    browserRequest(() => {
      check(config)
      return provider.testConnection(config, ctx)
    })
  if ('transcribe' in provider)
    return {
      ...provider,
      testConnection,
      transcribe: (input, config, ctx) =>
        browserRequest(() => {
          check(config)
          return provider.transcribe(input, config, ctx)
        }),
    } as P
  const llm: LlmProvider = {
    ...provider,
    testConnection,
    generateObject: (request, config, ctx) =>
      browserRequest(() => {
        check(config)
        return provider.generateObject(request, config, ctx)
      }),
  }
  return llm as P
}
export const listProviders: typeof shared.listProviders = (kind) =>
  shared.listProviders(kind).map(browserProvider)
export const getProvider: typeof shared.getProvider = (kind, id) =>
  browserProvider(shared.getProvider(kind, id))
