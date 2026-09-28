import { expect, it } from 'vitest'
import type { RecorderStatus } from '@huilu/recorder'
import { recorderPollInterval } from './recording'
const status = { state: 'recording', session: { id: 'current' } } as RecorderStatus
it('samples fast only while the recording meter is visible', () => {
  expect(recorderPollInterval(status)).toBe(200)
  expect(recorderPollInterval(status, { meterVisible: false })).toBe(1000)
  expect(recorderPollInterval(status, { hiddenFor: 'current' })).toBe(1000)
  // 关闭后的下一场录制自动显示；恢复展开后也恢复采样。
  expect(recorderPollInterval(status, { hiddenFor: 'previous', meterVisible: true })).toBe(200)
})
it.each(['idle', 'paused', 'starting', 'stopping'] as const)(
  'does not sample fast while %s',
  (state) => {
    expect(recorderPollInterval({ ...status, state })).toBe(1000)
  },
)
