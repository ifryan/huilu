import { afterEach, expect, it, vi } from 'vitest'
import { sendResultNotification } from './result-notification'
afterEach(() => vi.useRealTimers())
it('retries a lost response; the receiver is responsible for durable deduplication', async () => {
  vi.useFakeTimers()
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('The message port closed before a response was received.'))
    .mockResolvedValue(undefined)
  const pending = sendResultNotification(send)
  await vi.runAllTimersAsync()
  await pending
  expect(send).toHaveBeenCalledTimes(2)
})
it('does not hide unexpected errors or retry indefinitely', async () => {
  const unexpected = vi.fn().mockRejectedValue(new Error('database broken'))
  await expect(sendResultNotification(unexpected)).rejects.toThrow('database broken')
  expect(unexpected).toHaveBeenCalledTimes(1)
  vi.useFakeTimers()
  const disconnected = vi.fn().mockRejectedValue(new Error('message port closed'))
  const pending = expect(sendResultNotification(disconnected)).rejects.toThrow(
    'message port closed',
  )
  await vi.runAllTimersAsync()
  await pending
  expect(disconnected).toHaveBeenCalledTimes(3)
})
