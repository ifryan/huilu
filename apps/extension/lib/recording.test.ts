import { expect, it } from 'vitest'
import type { RecorderStatus } from '@huilu/recorder'
import { defaultMeetingTitle, recorderPollInterval, startErrorText } from './recording'
const status = { state: 'recording', session: { id: 'current' } } as RecorderStatus
it('maps missing source audio from cross-context errors to actionable guidance', () => {
  const t = ((key: string) => key) as Parameters<typeof startErrorText>[0]
  expect(startErrorText(t, new Error('SourceAudioUnavailableError: unavailable'))).toBe(
    'recorder.error.sourceAudioUnavailable',
  )
})
it('preserves window-specific guidance after error serialization', () => {
  const t = ((key: string) => key) as Parameters<typeof startErrorText>[0]
  expect(startErrorText(t, 'WindowAudioUnavailableError: unavailable')).toBe(
    'recorder.error.windowAudioUnavailable',
  )
})
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

it('default meeting title uses local time as Meeting_YYYYMMDD_HHmmss', () => {
  expect(defaultMeetingTitle(new Date(2026, 9, 5, 9, 7, 3))).toBe('Meeting_20261005_090703')
})
