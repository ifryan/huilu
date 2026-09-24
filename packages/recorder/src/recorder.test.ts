import { Meeting } from '@huilu/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUDIO_MIME_CANDIDATES,
  ChunkWriteError,
  InsufficientStorageError,
  NoAudioSourceError,
  RecorderBusyError,
  RecorderController,
  RecordingStore,
  VIDEO_MIME_CANDIDATES,
  createRecordingId,
  estimateBytesPerHour,
  extensionForMime,
  listLocalRecordings,
  previewTrack,
  pickMimeType,
  writeVerified,
  type RecordingOptions,
} from './index'
import { FakeClock, FakeMedia, MemoryFs, flush } from './test-helpers'

const options = (over: Partial<RecordingOptions> = {}): Omit<RecordingOptions, 'id'> => ({
  title: '需求评审',
  mode: 'video',
  source: 'tab',
  streamId: 'stream-1',
  sourceAudio: true,
  quality: { resolution: '720p', fps: 15 },
  microphone: { enabled: true },
  language: 'zh',
  ...over,
})

describe('mime', () => {
  it('picks the first supported candidate, preferring H.264 + AAC', () => {
    expect(pickMimeType(VIDEO_MIME_CANDIDATES, () => true)).toBe(
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
    )
    // Linux Chrome：没有 AAC，退回 H.264 + Opus
    expect(pickMimeType(VIDEO_MIME_CANDIDATES, (m) => !m.includes('mp4a'))).toBe(
      'video/mp4;codecs=avc1.640028,opus',
    )
    expect(pickMimeType(AUDIO_MIME_CANDIDATES, () => false)).toBeUndefined()
  })

  it('maps MIME types to file extensions', () => {
    expect(extensionForMime('video/mp4;codecs=avc1,opus')).toBe('mp4')
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm')
  })
})

describe('quality', () => {
  it('estimates storage per hour', () => {
    // 仅音频：24kbps ≈ 10.8MB/小时
    expect(estimateBytesPerHour(null)).toBe(10_800_000)
    const hd = estimateBytesPerHour({ resolution: '720p', fps: 15 })
    const fhd = estimateBytesPerHour({ resolution: '1080p', fps: 30 })
    expect(hd).toBeGreaterThan(300e6)
    expect(hd).toBeLessThan(600e6)
    expect(fhd).toBeGreaterThan(hd)
  })
})

describe('writeVerified', () => {
  it('detects writes that silently produce empty files', async () => {
    const fs = new MemoryFs()
    const dir = (await fs.provider()) as FileSystemDirectoryHandle
    await writeVerified(dir, 'ok.part', new Blob(['abc']))
    fs.fault = () => 'empty'
    await expect(writeVerified(dir, 'bad.part', new Blob(['abc']))).rejects.toThrow(
      /wrote 0 of 3 bytes/,
    )
    fs.fault = () => 'throw'
    await expect(writeVerified(dir, 'bad.part', 'x')).rejects.toBeInstanceOf(ChunkWriteError)
  })
})

describe('createRecordingId', () => {
  it('sorts by local start time', () => {
    const id = createRecordingId(new Date(2026, 8, 24, 14, 30, 5))
    expect(id).toMatch(/^20260924-143005-[0-9a-f]{8}$/)
  })
})

describe('RecorderController', () => {
  let fs: MemoryFs
  let media: FakeMedia
  let clock: FakeClock
  let store: RecordingStore
  let finished: unknown[]
  let controller: RecorderController

  beforeEach(() => {
    fs = new MemoryFs()
    media = new FakeMedia()
    clock = new FakeClock()
    store = new RecordingStore(fs.provider)
    finished = []
    controller = new RecorderController({
      store,
      media,
      now: clock.now,
      onFinished: (r) => finished.push(r),
    })
  })

  const recorders = () => {
    const [video, audio] = media.recorders
    return { video: video!, audio: audio! }
  }

  it('records video + transcript audio in 5s chunks and writes meeting.json on stop', async () => {
    const status = await controller.start(options({ id: 'rec1' }))
    expect(status.state).toBe('recording')
    const { video, audio } = recorders()
    expect(video.timeslice).toBe(5000)
    expect(video.mimeType).toBe('video/mp4;codecs=avc1.640028,opus')
    expect(video.options.videoKeyFrameIntervalDuration).toBe(1000)
    expect(audio.mimeType).toBe('audio/webm;codecs=opus')
    expect(audio.options.audioBitsPerSecond).toBe(24_000)

    clock.advance(5000)
    video.emit('v1')
    audio.emit('a1')
    await flush()
    expect(await fs.root.read('recordings/rec1/video/000001.part')).toBe('v1')
    const live = JSON.parse((await fs.root.read('recordings/rec1/manifest.json'))!)
    expect(live.state).toBe('recording')
    expect(live.tracks.audio.chunks).toBe(1)
    expect(controller.status().session?.bytes).toBe(4)

    clock.advance(3000)
    const done = await controller.stop()
    expect(done.state).toBe('idle')
    expect(done.lastResult).toMatchObject({ id: 'rec1', endReason: 'user', saved: true })
    expect(media.stopped).toBe(1)

    const meeting = Meeting.parse(JSON.parse((await fs.root.read('recordings/rec1/meeting.json'))!))
    expect(meeting).toMatchObject({
      id: 'rec1',
      title: '需求评审',
      status: 'processing',
      mode: 'video',
      videoSource: 'tab',
      durationMs: 8000,
      media: {
        video: { mimeType: 'video/mp4;codecs=avc1.640028,opus', width: 1280, height: 720 },
        audio: { mimeType: 'audio/webm;codecs=opus' },
      },
    })
    const manifest = JSON.parse((await fs.root.read('recordings/rec1/manifest.json'))!)
    expect(manifest.state).toBe('stopped')
    // stop() 时输出的最后一个分片也要落盘
    expect(manifest.tracks.video.chunks).toBe(2)
    expect(finished).toHaveLength(1)

    const dir = (await store.open('rec1'))!
    expect(await (await dir.readTrack('video', 2, 'video/mp4')).text()).toBe('v1tail')
  })

  it('records only the transcript audio track in audio mode', async () => {
    await controller.start(options({ id: 'a', mode: 'audio' }))
    expect(media.recorders).toHaveLength(1)
    await controller.stop()
    const meeting = (await (await store.open('a'))!.readMeeting())!
    expect(meeting.mode).toBe('audio')
    expect(meeting.videoSource).toBeUndefined()
    expect(meeting.media?.video).toBeUndefined()
  })

  it('rejects a concurrent start while the first one is still starting', async () => {
    const first = controller.start(options({ id: 'one' }))
    await expect(controller.start(options({ id: 'two' }))).rejects.toBeInstanceOf(RecorderBusyError)
    await first
    await expect(controller.start(options())).rejects.toBeInstanceOf(RecorderBusyError)
    await controller.stop()
    // 结束后可以再次开始
    await expect(controller.start(options({ id: 'three' }))).resolves.toMatchObject({
      state: 'recording',
    })
    expect(media.requests).toHaveLength(2)
  })

  it('frees the lock and cleans up when starting fails', async () => {
    media.captureError = new DOMException('Permission denied', 'NotAllowedError')
    await expect(controller.start(options({ id: 'x' }))).rejects.toThrow('Permission denied')
    expect(controller.status().state).toBe('idle')
    media.captureError = undefined
    await controller.start(options({ id: 'y' }))
    expect(await store.list()).toEqual(['y'])
  })

  it('refuses to start without enough storage and warns when space is low', async () => {
    media.available = 10e6
    await expect(controller.start(options())).rejects.toBeInstanceOf(InsufficientStorageError)
    media.available = 200e6
    const status = await controller.start(options())
    expect(status.session?.warnings).toContain('low-storage')
  })

  it('refuses to start when no format is supported', async () => {
    media.supported = () => false
    await expect(controller.start(options())).rejects.toThrow(/supported format/)
    expect(media.requests).toHaveLength(0)
  })

  it('excludes paused time from the duration', async () => {
    await controller.start(options({ id: 'p' }))
    clock.advance(10_000)
    expect(controller.pause().state).toBe('paused')
    expect(recorders().video.state).toBe('paused')
    clock.advance(60_000)
    expect(controller.status().session?.elapsedMs).toBe(10_000)
    expect(controller.resume().state).toBe('recording')
    clock.advance(5_000)
    const { lastResult } = await controller.stop()
    expect(lastResult?.durationMs).toBe(15_000)
  })

  it('finishes automatically when the tab closes / sharing ends', async () => {
    await controller.start(options({ id: 's' }))
    recorders().audio.emit('a1')
    media.endSource()
    await flush()
    await flush()
    const status = controller.status()
    expect(status.state).toBe('idle')
    expect(status.lastResult).toMatchObject({ endReason: 'source-ended', saved: true })
    expect(await fs.root.read('recordings/s/meeting.json')).toBeDefined()
  })

  it('stops immediately when a chunk silently fails to write, keeping earlier chunks', async () => {
    await controller.start(options({ id: 'f' }))
    const { video, audio } = recorders()
    video.emit('v1')
    audio.emit('a1')
    await flush()
    fs.fault = (name) => (name === '000002.part' ? 'empty' : undefined)
    video.emit('v2')
    await flush()
    await flush()
    await flush()
    expect(video.state).toBe('inactive')
    const status = controller.status()
    expect(status.state).toBe('idle')
    expect(status.lastResult).toMatchObject({ endReason: 'error', saved: true })
    expect(status.lastResult?.error).toMatch(/000002\.part: wrote 0/)
    const manifest = (await (await store.open('f'))!.readManifest())!
    // 失败之后的分片（包括 stop 时的最后一片）不再写入，避免拼接出现缺口
    expect(manifest.tracks.video?.chunks).toBe(1)
    expect(manifest.state).toBe('stopped')
    expect(manifest.endReason).toBe('error')
  })

  it('ignores chunks that arrive after a recorder timed out on stop', async () => {
    controller = new RecorderController({ store, media, now: clock.now, stopTimeoutMs: 10 })
    await controller.start(options({ id: 'late' }))
    const { video, audio } = recorders()
    audio.emit('a1')
    await flush()
    // 视频录制器卡住：stop() 后迟迟不派发 stop 事件，也不输出最后一片
    video.stop = () => {}
    const { lastResult } = await controller.stop()
    video.emit('late')
    await flush()
    const manifest = (await (await store.open('late'))!.readManifest())!
    expect(manifest.state).toBe('stopped')
    expect(manifest.tracks.video?.chunks).toBe(0)
    // 超时不能当作正常结束：音频仍保留，但结果标为错误（部分保存）
    expect(lastResult).toMatchObject({ saved: true, endReason: 'error' })
    expect(lastResult?.error).toMatch(/RecorderStopTimeout: video/)
    expect(manifest.endReason).toBe('error')
  })

  it('reports an error when the final chunk fails to write during a user stop', async () => {
    await controller.start(options({ id: 'tail' }))
    const { video, audio } = recorders()
    video.emit('v1')
    audio.emit('a1')
    await flush()
    // stop() 时输出的最后一片写入失败
    fs.fault = (name) => (name === '000002.part' ? 'throw' : undefined)
    const { lastResult } = await controller.stop()
    expect(lastResult).toMatchObject({ saved: true, endReason: 'error' })
    expect(lastResult?.error).toMatch(/000002\.part/)
    const manifest = (await (await store.open('tail'))!.readManifest())!
    expect(manifest.endReason).toBe('error')
    expect(manifest.tracks.video?.chunks).toBe(1)
  })

  it('does not report success when the video track recorded nothing', async () => {
    await controller.start(options({ id: 'novideo' }))
    const { video, audio } = recorders()
    video.finalChunk = undefined
    audio.emit('a1')
    const { lastResult } = await controller.stop()
    expect(lastResult).toMatchObject({ saved: true, endReason: 'error' })
    expect(lastResult?.error).toBe('Video track recorded no data')
  })

  it('finishes a recording whose source ended while it was still starting', async () => {
    // 首次写 manifest 时（录制器尚未启动）来源结束
    fs.fault = (name) => {
      if (name === 'manifest.json') media.endSource()
      return undefined
    }
    await controller.start(options({ id: 'early', mode: 'audio' }))
    fs.fault = () => undefined
    await flush()
    await flush()
    const status = controller.status()
    expect(status.state).toBe('idle')
    expect(status.lastResult?.endReason).toBe('source-ended')
    expect(media.recorders.every((r) => r.state === 'inactive')).toBe(true)
  })

  it('keeps written video when the transcript audio times out with zero chunks', async () => {
    controller = new RecorderController({ store, media, now: clock.now, stopTimeoutMs: 10 })
    await controller.start(options({ id: 'vonly' }))
    const { video, audio } = recorders()
    video.emit('v1')
    await flush()
    // 转写音频录制器卡住：一片都没有，stop 事件也不来
    audio.finalChunk = undefined
    audio.stop = () => {}
    const { lastResult } = await controller.stop()
    expect(lastResult).toMatchObject({ saved: true, endReason: 'error' })
    expect(lastResult?.error).toMatch(/RecorderStopTimeout: audio/)
    expect(lastResult?.error).toMatch(/Transcript audio track recorded no data/)
    expect(await fs.root.read('recordings/vonly/video/000001.part')).toBe('v1')
    const meeting = Meeting.parse(
      JSON.parse((await fs.root.read('recordings/vonly/meeting.json'))!),
    )
    // 不能转写：没有 media.audio，状态不是 processing
    expect(meeting.status).toBe('failed')
    expect(meeting.media?.audio).toBeUndefined()
    expect(meeting.media?.video?.mimeType).toContain('video/mp4')
    const [item] = await listLocalRecordings(store)
    expect(item).toMatchObject({ id: 'vonly', state: 'partial', transcribable: false })
    expect(previewTrack(item!)).toBe('video')
  })

  it('keeps the video when the first transcript audio chunk fails to write', async () => {
    await controller.start(options({ id: 'afail' }))
    const { video, audio } = recorders()
    video.emit('v1')
    await flush()
    fs.fault = (name) => (name === '000001.part' ? 'throw' : undefined)
    audio.emit('a1')
    await flush()
    await flush()
    await flush()
    const status = controller.status()
    expect(status.state).toBe('idle')
    expect(status.lastResult).toMatchObject({ saved: true, endReason: 'error' })
    expect(status.lastResult?.error).toMatch(/000001\.part/)
    expect(await fs.root.read('recordings/afail/video/000001.part')).toBe('v1')
    const manifest = (await (await store.open('afail'))!.readManifest())!
    // 视频轨本身没出错：停止时输出的最后一片照常写入
    expect(manifest.tracks.video?.chunks).toBe(2)
    expect(manifest.tracks.audio?.chunks).toBe(0)
    const meeting = (await (await store.open('afail'))!.readMeeting())!
    expect(meeting.status).toBe('failed')
  })

  it('discards a recording that produced no data', async () => {
    await controller.start(options({ id: 'empty' }))
    for (const r of media.recorders) r.finalChunk = undefined
    const { lastResult } = await controller.stop()
    expect(lastResult).toMatchObject({ saved: false, error: 'No data was recorded' })
    expect(await store.list()).toEqual([])
  })

  it('surfaces capture warnings such as an unavailable microphone', async () => {
    media.warnings = ['mic-unavailable']
    await controller.start(options({ id: 'm' }))
    expect(controller.status().session?.warnings).toEqual(['mic-unavailable'])
    await controller.stop()
    const manifest = (await (await store.open('m'))!.readManifest())!
    expect(manifest.microphone).toBe(false)
  })

  describe('recovery after a crash', () => {
    /** 模拟浏览器崩溃：录制到一半，离屏文档连同 controller 一起消失 */
    async function crashMidRecording() {
      await controller.start(options({ id: 'crash' }))
      const { video, audio } = recorders()
      clock.advance(5000)
      video.emit('v1')
      audio.emit('a1')
      await flush()
      clock.advance(5000)
      video.emit('v2')
      audio.emit('a2')
      await flush()
      return new RecorderController({ store, media, now: clock.now })
    }

    it('lists and recovers unfinished recordings', async () => {
      const fresh = await crashMidRecording()
      // 另一个进程里仍在录的不算未完成
      expect(await controller.listUnfinished()).toEqual([])
      const [unfinished] = await fresh.listUnfinished()
      expect(unfinished).toMatchObject({ id: 'crash', title: '需求评审', activeMs: 10_000 })

      const meeting = await fresh.recover('crash')
      expect(meeting).toMatchObject({ id: 'crash', status: 'processing', durationMs: 10_000 })
      expect(await fresh.listUnfinished()).toEqual([])
      const manifest = (await (await store.open('crash'))!.readManifest())!
      expect(manifest).toMatchObject({ state: 'stopped', endReason: 'recovered' })
    })

    it('trusts the chunks on disk over a stale manifest and stops at the first gap', async () => {
      const fresh = await crashMidRecording()
      const dir = (await store.open('crash'))!
      // manifest 落后于磁盘：第 3 片写完后、更新 manifest 前崩溃
      await dir.writeChunk('audio', 3, new Blob(['a3']))
      // 视频第 4 片存在但第 3 片缺失：只能用到第 2 片
      await dir.writeChunk('video', 4, new Blob(['v4']))
      await fresh.recover('crash')
      const manifest = (await dir.readManifest())!
      expect(manifest.tracks.audio?.chunks).toBe(3)
      expect(manifest.tracks.video?.chunks).toBe(2)
    })

    it('recovers a crash that left only video chunks, marking it not transcribable', async () => {
      await controller.start(options({ id: 'crashv' }))
      recorders().video.emit('v1')
      await flush()
      const next = new RecorderController({ store, media, now: clock.now })
      const meeting = await next.recover('crashv')
      expect(meeting?.status).toBe('failed')
      expect(meeting?.media?.audio).toBeUndefined()
      expect(await fs.root.read('recordings/crashv/video/000001.part')).toBe('v1')
      const manifest = (await (await store.open('crashv'))!.readManifest())!
      expect(manifest.state).toBe('stopped')
      expect(manifest.error).toMatch(/cannot be transcribed/)
    })

    it('removes a crashed recording only when no track has any chunk', async () => {
      await controller.start(options({ id: 'crash0' }))
      const next = new RecorderController({ store, media, now: clock.now })
      expect(await next.recover('crash0')).toBeUndefined()
      expect(await store.list()).not.toContain('crash0')
    })

    it('can discard an unfinished recording', async () => {
      const fresh = await crashMidRecording()
      await fresh.discard('crash')
      expect(await store.list()).toEqual([])
    })

    it('does not touch the recording in progress', async () => {
      await controller.start(options({ id: 'live' }))
      await expect(controller.recover('live')).rejects.toBeInstanceOf(RecorderBusyError)
      await expect(controller.discard('live')).rejects.toBeInstanceOf(RecorderBusyError)
    })
  })

  it('fails to start in audio mode without any audio source', async () => {
    media.captureError = new NoAudioSourceError()
    await expect(controller.start(options({ mode: 'audio' }))).rejects.toBeInstanceOf(
      NoAudioSourceError,
    )
  })
})

describe('listLocalRecordings', () => {
  it('lists saved, partial, unfinished and damaged recordings without touching them', async () => {
    const fs = new MemoryFs()
    const media = new FakeMedia()
    const clock = new FakeClock()
    const store = new RecordingStore(fs.provider)
    const controller = new RecorderController({ store, media, now: clock.now })

    await controller.start(options({ id: '20260924-100000-a', mode: 'audio' }))
    clock.advance(30_000)
    media.recorders.at(-1)!.emit('a1')
    await controller.stop()

    await controller.start(options({ id: '20260924-110000-b' }))
    const [video, audio] = media.recorders.slice(-2)
    video!.finalChunk = undefined
    audio!.emit('a1')
    await controller.stop()

    // 意外中断：manifest 还是 recording 状态
    await controller.start(options({ id: '20260924-120000-c' }))
    media.recorders.at(-1)!.emit('a1')
    await flush()
    const crashed = new RecorderController({ store, media, now: clock.now })
    void crashed

    // 只有目录、manifest 损坏
    await (
      await store.create('20260924-130000-d')
    ).handle.getFileHandle('manifest.json', {
      create: true,
    })

    const before = JSON.stringify([...fs.root.dirs.keys()])
    const list = await listLocalRecordings(store)
    expect(list.map((r) => [r.id, r.state])).toEqual([
      ['20260924-130000-d', 'damaged'],
      ['20260924-120000-c', 'unfinished'],
      ['20260924-110000-b', 'partial'],
      ['20260924-100000-a', 'saved'],
    ])
    const saved = list.at(-1)!
    expect(saved).toMatchObject({ title: '需求评审', mode: 'audio', processing: 'processing' })
    expect(saved.durationMs).toBe(30_000)
    expect(previewTrack(saved)).toBe('audio')
    expect(previewTrack(list[2]!)).toBe('audio')
    expect(list[2]!.error).toBe('Video track recorded no data')
    expect(JSON.stringify([...fs.root.dirs.keys()])).toBe(before)
  })
})
