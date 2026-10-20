import type * as RecorderModule from '@huilu/recorder'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RecorderBusyError, RecordingStore, mixCapturedStream } from '@huilu/recorder'
import { FakeMedia, MemoryFs, flush } from '../../../packages/recorder/src/test-helpers'
import { WebRecorder, chooseDisplay } from './recorder'
vi.mock('@huilu/recorder', async (original) => ({
  ...(await original<typeof RecorderModule>()),
  mixCapturedStream: vi.fn(),
}))
const options = {
  title: 'Web meeting',
  mode: 'audio' as const,
  sourceAudio: false,
  quality: { resolution: '720p' as const, fps: 15 as const },
  microphone: { enabled: true },
  language: 'en',
}
let fs: MemoryFs
let media: FakeMedia
let release: ReturnType<typeof vi.fn<() => void>>
let trackStop: ReturnType<typeof vi.fn<() => void>>
let web: WebRecorder
beforeEach(() => {
  fs = new MemoryFs()
  media = new FakeMedia()
  release = vi.fn()
  trackStop = vi.fn()
  vi.mocked(mixCapturedStream).mockImplementation((req) => media.capture(req))
  const stream = {
    getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'browser' }) }],
    getTracks: () => [{ stop: trackStop }],
  } as unknown as MediaStream
  web = new WebRecorder(
    { store: new RecordingStore(fs.provider) },
    async () => release,
    async () => stream,
    {
      capture: (r) => media.capture(r),
      createRecorder: (tracks, options) => media.createRecorder(tracks, options),
      isTypeSupported: media.isTypeSupported,
    },
  )
})
describe('web recording host', () => {
  it('rejects simultaneous local starts before opening a second picker', async () => {
    const first = web.start(options)
    await expect(web.start(options)).rejects.toBeInstanceOf(RecorderBusyError)
    await first
    expect(release).not.toHaveBeenCalled()
    await web.controller.stop()
    await flush()
    expect(release).toHaveBeenCalledOnce()
  })
  it('rejects the other tab lease and releases the pre-opened source', async () => {
    const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
    const host = new WebRecorder(
      { store: new RecordingStore(fs.provider) },
      async () => {
        throw new RecorderBusyError()
      },
      async () => stream,
    )
    await expect(host.start(options)).rejects.toBeInstanceOf(RecorderBusyError)
    await flush()
    expect(trackStop).toHaveBeenCalledOnce()
  })
  it('stops and releases its lease after a verified chunk write fails', async () => {
    await web.start(options)
    fs.fault = (name) => (name.endsWith('.part') ? 'empty' : undefined)
    media.recorders[0]!.emit('not-empty')
    await vi.waitFor(() => expect(web.status().state).toBe('idle'))
    expect(media.stopped).toBe(1)
    expect(release).toHaveBeenCalledOnce()
    expect(web.status().lastResult?.saved).toBe(false)
    expect(web.status().lastResult?.error).toContain('ChunkWriteError')
  })
  it('handles browser stop-sharing as source-ended and retains media', async () => {
    await web.start(options)
    media.recorders[0]!.emit('audio')
    await flush()
    media.endSource()
    await vi.waitFor(() => expect(web.status().state).toBe('idle'))
    expect(web.status().lastResult).toMatchObject({ endReason: 'source-ended', saved: true })
    expect(release).toHaveBeenCalledOnce()
  })
  it('cleans up source and lock when initialization fails before media capture', async () => {
    media.supported = () => false
    await expect(web.start(options)).rejects.toThrow('supported format')
    await flush()
    expect(trackStop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })
  it('opens the display picker in the click stack with web-specific hints', async () => {
    const getDisplayMedia = vi.fn(async () => ({}) as MediaStream)
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    const promise = chooseDisplay(true, null)
    expect(getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        video: expect.objectContaining({ displaySurface: 'browser' }),
      }),
    )
    await promise
    vi.unstubAllGlobals()
  })
})
