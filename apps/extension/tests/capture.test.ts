import { fakeBrowser } from 'wxt/testing/fake-browser'
import { beforeEach, expect, it, vi } from 'vitest'
import { chooseDesktopSource, requestTabCapture } from '@/platform/capture'
const choose = vi.fn()
beforeEach(() => {
  fakeBrowser.reset()
  choose.mockReset()
  Object.assign(fakeBrowser, {
    desktopCapture: { chooseDesktopMedia: choose },
    tabCapture: { getMediaStreamId: async () => 'tab-stream' },
  })
})
it.each(['window', 'screen'] as const)(
  'omits audio from the native %s picker when disabled, even if the grant offers it',
  async (source) => {
    choose.mockImplementation((sources, callback) => {
      expect(sources).toEqual([source])
      callback('stream', { canRequestAudioTrack: true })
    })
    expect(await chooseDesktopSource(source, false)).toEqual({
      streamId: 'stream',
      sourceAudio: false,
    })
  },
)
it('uses the actual browser audio grant when requested', async () => {
  choose.mockImplementation((sources, callback) => {
    expect(sources).toEqual(['screen', 'audio'])
    callback('stream', { canRequestAudioTrack: false })
  })
  expect((await chooseDesktopSource('screen', true)).sourceAudio).toBe(false)
  expect((await requestTabCapture(1, false)).sourceAudio).toBe(false)
})
