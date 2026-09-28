// Node 中用可检查连接关系的 Web Audio / MediaStream 替身，不启动浏览器或设备。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserMediaBackend } from './browser-media'
import { RecordingSession, type RecordingOptions } from './session'
import { RecordingStore } from './store'
import { FakeMedia, MemoryFs } from './test-helpers'

class Track {
  readyState = 'live'
  enabled = true
  muted = false
  constructor(readonly kind: string) {}
  stop = vi.fn(() => {
    this.readyState = 'ended'
  })
  getSettings = () => ({})
  addEventListener = vi.fn()
}
class Stream {
  constructor(readonly tracks: Track[] = []) {}
  getTracks = () => this.tracks
  getAudioTracks = () => this.tracks.filter((t) => t.kind === 'audio')
  getVideoTracks = () => this.tracks.filter((t) => t.kind === 'video')
}
class AudioNodeMock {
  connections: AudioNodeMock[] = []
  connect = (target: AudioNodeMock) => {
    this.connections.push(target)
    return target
  }
}
class Context {
  static current: Context
  state = 'running'
  destination = new AudioNodeMock()
  sources: { stream: Stream; node: AudioNodeMock }[] = []
  bus = new AudioNodeMock()
  sample = 0
  constructor() {
    Context.current = this
  }
  createGain = () => this.bus
  createConstantSource = () =>
    Object.assign(new AudioNodeMock(), { offset: { value: 0 }, start() {} })
  createMediaStreamDestination = () =>
    Object.assign(new AudioNodeMock(), { stream: new Stream([new Track('audio')]) })
  createMediaStreamSource = (stream: Stream) => {
    const node = new AudioNodeMock()
    this.sources.push({ stream, node })
    return node
  }
  createAnalyser = () =>
    Object.assign(new AudioNodeMock(), {
      fftSize: 2048,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(this.sample),
    })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  resume = vi.fn(async () => {
    this.state = 'running'
  })
}
const request: RecordingOptions = {
  id: 'test',
  title: 'test',
  language: 'zh',
  source: 'tab',
  mode: 'video',
  streamId: 'stream',
  sourceAudio: true,
  sourceAudioRequested: true,
  quality: { resolution: '720p', fps: 15 },
  microphone: { enabled: true },
}
let source: Stream
let mic: Stream
let getUserMedia: ReturnType<typeof vi.fn>
beforeEach(() => {
  source = new Stream([new Track('video'), new Track('audio')])
  mic = new Stream([new Track('audio')])
  getUserMedia = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(mic)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('AudioContext', Context)
})
afterEach(() => vi.unstubAllGlobals())

describe('actual audio routing', () => {
  it.each(['tab', 'window', 'screen'] as const)(
    'never mixes source audio when disabled for %s, including an unexpected returned track',
    async (sourceType) => {
      const captured = await browserMediaBackend.capture({
        ...request,
        source: sourceType,
        sourceAudio: false,
        sourceAudioRequested: false,
      })
      expect(getUserMedia.mock.calls[0]![0].audio).toBe(false)
      expect(source.getAudioTracks()[0]!.stop).toHaveBeenCalledOnce()
      expect(Context.current.sources.map((s) => s.stream)).toEqual([mic])
      expect(captured.warnings).not.toContain('source-audio-unavailable')
      captured.stop()
    },
  )
  it('captures minimal video for audio-only mic recording with source audio disabled', async () => {
    const captured = await browserMediaBackend.capture({
      ...request,
      mode: 'audio',
      sourceAudio: false,
      sourceAudioRequested: false,
    })
    expect(getUserMedia.mock.calls[0]![0].video).toBeTruthy()
    expect(captured.transcriptAudioTrack).toBeDefined()
    captured.stop()
  })
  it('warns about missing source audio even when a working microphone permits recording', async () => {
    source.tracks.splice(1)
    const captured = await browserMediaBackend.capture({
      ...request,
      source: 'screen',
      sourceAudio: false,
    })
    expect(captured.warnings).toEqual(['source-audio-unavailable'])
    expect(captured.transcriptAudioTrack).toBeDefined()
    captured.stop()
  })
  it('omits transcription for silent video and rejects audio-only recordings with no inputs', async () => {
    const captured = await browserMediaBackend.capture({
      ...request,
      sourceAudio: false,
      sourceAudioRequested: false,
      microphone: { enabled: false },
    })
    expect(captured.transcriptAudioTrack).toBeUndefined()
    expect(captured.warnings).toContain('no-audio')
    captured.stop()
    getUserMedia.mockReset().mockResolvedValue(source)
    await expect(
      browserMediaBackend.capture({
        ...request,
        mode: 'audio',
        sourceAudio: false,
        microphone: { enabled: false },
      }),
    ).rejects.toThrow('No audio to record')
    expect(Context.current.close).toHaveBeenCalledOnce()
  })
  it('measures the same mix used for recording, shows silence, and stops with the audio context', async () => {
    const captured = await browserMediaBackend.capture(request)
    const context = Context.current
    expect(context.sources).toHaveLength(2)
    expect(context.sources.every((s) => s.node.connections.includes(context.bus))).toBe(true)
    expect(captured.audioLevel?.()).toBe(0)
    context.sample = 10 ** (-30 / 20)
    expect(captured.audioLevel?.()).toBeCloseTo(0.5)
    context.sample = 1
    expect(captured.audioLevel?.()).toBe(1)
    captured.stop()
    expect(captured.audioLevel?.()).toBe(0)
    expect(source.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
    expect(mic.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
  })
  it('stops the already opened source if AudioContext creation fails', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('audio unavailable')
        }
      },
    )
    await expect(browserMediaBackend.capture(request)).rejects.toThrow('audio unavailable')
    expect(source.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
  })
})

it('session levels follow recording / pause / resume / stop, with no persisted schema changes', async () => {
  const media = new FakeMedia()
  const original = media.capture.bind(media)
  media.capture = async (req) => ({ ...(await original(req)), audioLevel: () => 0.6 })
  const session = new RecordingSession(request, {
    media,
    store: new RecordingStore(new MemoryFs().provider),
  })
  expect((await session.start()).audioLevel).toBe(0.6)
  expect(session.pause().audioLevel).toBe(0)
  expect(session.resume().audioLevel).toBe(0.6)
  const stopping = session.stop()
  expect(session.status().audioLevel).toBe(0)
  await stopping
  expect(session.status().audioLevel).toBe(0)
})
