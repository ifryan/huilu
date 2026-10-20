import { fakeBrowser } from 'wxt/testing/fake-browser'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  chooseDesktopSource,
  requestTabCapture,
  openChosenSource,
  selectedSource,
} from '@/platform/capture'
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
it.each(['window', 'screen'] as const)(
  'uses the actual %s audio grant when requested',
  async (source) => {
    choose.mockImplementation((sources, callback) => {
      expect(sources).toEqual([source, 'audio'])
      callback('stream', { canRequestAudioTrack: false })
    })
    expect((await chooseDesktopSource(source, true)).sourceAudio).toBe(false)
    expect((await requestTabCapture(1, false)).sourceAudio).toBe(false)
  },
)

afterEach(() => vi.unstubAllGlobals())

it.each([true, false])('offers all three source types in one picker (audio=%s)', async (audio) => {
  choose.mockImplementation((sources, callback) => {
    expect(sources).toEqual(
      audio ? ['tab', 'window', 'screen', 'audio'] : ['tab', 'window', 'screen'],
    )
    callback('desktop-token', { canRequestAudioTrack: true })
  })
  expect(await chooseDesktopSource('choose', audio)).toEqual({
    streamId: 'desktop-token',
    sourceAudio: audio,
  })
})

it.each([
  ['browser', 'tab'],
  ['window', 'window'],
  ['monitor', 'screen'],
] as const)(
  'records actual %s surface as %s and consumes all unified tokens as desktop',
  async (displaySurface, source) => {
    const track = { getSettings: () => ({ displaySurface }), stop: vi.fn() }
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] }
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    expect(
      await openChosenSource({ streamId: 'desktop-token', sourceAudio: false }, false, null),
    ).toEqual({ stream, source })
    expect(getUserMedia.mock.calls[0]![0]).toMatchObject({
      video: { mandatory: { chromeMediaSource: 'desktop', maxFrameRate: 1 } },
      audio: false,
    })
  },
)

it('does not guess unreported surface metadata and releases every granted track', async () => {
  const track = { getSettings: () => ({}), stop: vi.fn() }
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getVideoTracks: () => [track], getTracks: () => [track] }),
    },
  })
  expect(() => selectedSource({})).toThrow('did not identify')
  await expect(
    openChosenSource({ streamId: 'token', sourceAudio: false }, false, null),
  ).rejects.toThrow('did not identify')
  expect(track.stop).toHaveBeenCalledOnce()
})

it('rejects declined source audio before consuming the video token or opening a mic', async () => {
  const getUserMedia = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  await expect(
    openChosenSource({ streamId: 'token', sourceAudio: false }, true, null),
  ).rejects.toMatchObject({ name: 'SourceAudioUnavailableError' })
  expect(getUserMedia).not.toHaveBeenCalled()
})
