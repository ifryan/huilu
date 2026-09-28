import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { claimResultNotification } from './result-notifications'

it('claims only once across concurrent callers and subsequent restarts', async () => {
  expect(
    (
      await Promise.all(Array.from({ length: 10 }, () => claimResultNotification('completed')))
    ).filter(Boolean),
  ).toHaveLength(1)
  expect(await claimResultNotification('completed')).toBe(false)
  expect(await claimResultNotification('another-meeting')).toBe(true)
})
