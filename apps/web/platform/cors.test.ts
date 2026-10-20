import { expect, it } from 'vitest'
import {
  browserCors,
  browserRequestError,
  openAiCompatibleLlm,
  ProviderError,
} from '@huilu/providers'
it('separates likely CORS from offline and typed HTTP errors', () => {
  const failed = new TypeError('Failed to fetch')
  expect(browserRequestError(failed, true)).toMatchObject({ code: 'cors' })
  expect(browserRequestError(new ProviderError('network'), true)).toMatchObject({ code: 'cors' })
  expect(browserRequestError(failed, false)).toBe(failed)
  const unauthorized = new ProviderError('unauthorized')
  expect(browserRequestError(unauthorized, true)).toBe(unauthorized)
})
it('blocks Coding Plan even with an imported custom endpoint', () => {
  expect(browserCors(openAiCompatibleLlm, { preset: 'glmCodingPlan' })).toBe('blocked')
  expect(
    browserCors(openAiCompatibleLlm, {
      preset: 'custom',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    }),
  ).toBe('blocked')
  expect(
    browserCors(openAiCompatibleLlm, { preset: 'custom', baseUrl: 'https://proxy.example/v1' }),
  ).toBe('unknown')
})
