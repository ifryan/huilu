import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { claimResultNotification, releaseResultNotification } from './result-notifications'

it('claims only once across concurrent callers and subsequent restarts', async () => {
  expect(
    (
      await Promise.all(Array.from({ length: 10 }, () => claimResultNotification('completed')))
    ).filter(Boolean),
  ).toHaveLength(1)
  expect(await claimResultNotification('completed')).toBe(false)
  expect(await claimResultNotification('another-meeting')).toBe(true)
})

it('allows another delivery attempt after a failed tab operation releases its claim', async () => {
  expect(await claimResultNotification('retry')).toBe(true)
  await releaseResultNotification('retry')
  expect(await claimResultNotification('retry')).toBe(true)
  expect(await claimResultNotification('retry')).toBe(false)
})
