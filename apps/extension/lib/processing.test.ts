import { MEETING_SCHEMA_VERSION, type Meeting } from '@huilu/core'
import { RecordingStore, type RecordingManifest } from '@huilu/recorder'
import { describe, expect, it, vi } from 'vitest'
// 录制包内部的内存 OPFS（测试专用，不在包的导出里）
import { MemoryFs } from '../../../packages/recorder/src/test-helpers'
import { recordingSource, resolveService, resolveServices } from './processing'

const granted = async () => true

describe('resolveService', () => {
  const paraformer = { region: 'cn', apiKey: 'sk-x', model: 'paraformer-v2' }

  it('returns the selected provider with its parsed config', async () => {
    const check = vi.fn(granted)
    const r = await resolveService(
      'transcription',
      { providerId: 'dashscope-paraformer', configs: { 'dashscope-paraformer': paraformer } },
      check,
    )
    expect(r).toMatchObject({
      ok: true,
      provider: { id: 'dashscope-paraformer' },
      config: paraformer,
    })
    expect(check).toHaveBeenCalledWith('https://dashscope.aliyuncs.com')
  })

  it('never falls back to the default provider for an unknown id', async () => {
    const r = await resolveService(
      'transcription',
      { providerId: 'deepgram', configs: { deepgram: { apiKey: 'dg' } } },
      granted,
    )
    expect(r).toEqual({ ok: false, issue: 'unknownProvider' })
  })

  it('reports missing / invalid configs', async () => {
    for (const configs of [{}, { 'dashscope-paraformer': { region: 'cn' } }] as Record<
      string,
      Record<string, unknown>
    >[]) {
      expect(
        await resolveService(
          'transcription',
          { providerId: 'dashscope-paraformer', configs },
          granted,
        ),
      ).toEqual({ ok: false, issue: 'notConfigured' })
    }
  })

  it('reports a missing host permission for custom base URLs', async () => {
    const llm = {
      providerId: 'openai-compatible',
      configs: {
        'openai-compatible': { preset: 'custom', baseUrl: 'https://llm.example/v1', model: 'm' },
      },
    }
    expect(await resolveService('llm', llm, async () => false)).toEqual({
      ok: false,
      issue: 'hostPermission',
    })
    expect(await resolveService('llm', llm, () => Promise.reject(new Error('x')))).toEqual({
      ok: false,
      issue: 'hostPermission',
    })
  })

  it('resolves both services independently', async () => {
    const r = await resolveServices(
      {
        transcription: {
          providerId: 'dashscope-paraformer',
          configs: { 'dashscope-paraformer': paraformer },
        },
        llm: { providerId: 'openai-compatible', configs: {} },
      },
      granted,
    )
    expect(r.transcription.ok).toBe(true)
    expect(r.llm).toEqual({ ok: false, issue: 'notConfigured' })
  })
})

describe('recordingSource', () => {
  const manifest = (tracks: RecordingManifest['tracks']): RecordingManifest => ({
    version: 1,
    id: 'r1',
    title: '评审',
    mode: 'video',
    videoSource: 'tab',
    language: 'zh',
    microphone: false,
    state: 'stopped',
    startedAt: 0,
    updatedAt: 0,
    activeMs: 10_000,
    tracks,
  })
  const meeting: Meeting = {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'r1',
    title: '评审',
    createdAt: new Date(0).toISOString(),
    durationMs: 10_000,
    mode: 'video',
    language: 'zh',
    speakers: [],
    markers: [],
    status: 'processing',
    providers: {},
  }

  async function setup(tracks: RecordingManifest['tracks']) {
    const fs = new MemoryFs()
    const store = new RecordingStore(fs.provider)
    const dir = await store.create('r1')
    await dir.writeManifest(manifest(tracks))
    await dir.writeMeeting(meeting)
    for (const [name, t] of Object.entries(tracks)) {
      for (let seq = 1; seq <= (t?.chunks ?? 0); seq++) {
        await dir.writeChunk(name as 'audio' | 'video', seq, new Blob([`${name}${seq}`]))
      }
    }
    return recordingSource(store)
  }

  it('reads the transcription audio and the media files to copy', async () => {
    const source = await setup({
      audio: { mimeType: 'audio/webm;codecs=opus', chunks: 2, bytes: 12, sizes: [6, 6] },
      video: { mimeType: 'video/mp4;codecs=avc1,opus', chunks: 1, bytes: 6, sizes: [6] },
    })
    const audio = await source.readAudio('r1')
    expect(audio?.mimeType).toBe('audio/webm;codecs=opus')
    expect(await audio?.blob.text()).toBe('audio1audio2')
    const media = await source.readMedia('r1')
    expect(media.map((m) => m.name)).toEqual(['video.mp4', 'audio.webm'])
    expect((await source.readMeeting('r1'))?.status).toBe('processing')
    await source.writeMeeting('r1', { ...meeting, status: 'ready' })
    expect((await source.readMeeting('r1'))?.status).toBe('ready')
  })

  it('has no audio for video-only recordings', async () => {
    const source = await setup({
      audio: { mimeType: 'audio/webm;codecs=opus', chunks: 0, bytes: 0, sizes: [] },
      video: { mimeType: 'video/webm;codecs=vp9,opus', chunks: 1, bytes: 6, sizes: [6] },
    })
    expect(await source.readAudio('r1')).toBeUndefined()
    expect((await source.readMedia('r1')).map((m) => m.name)).toEqual(['video.webm'])
    expect(await source.readAudio('missing')).toBeUndefined()
  })

  it.each(['directory', 'manifest', 'invalidManifest', 'unreadableManifest', 'declaredTrack'])(
    'rejects unavailable source media after losing %s',
    async (missing) => {
      const fs = new MemoryFs()
      const store = new RecordingStore(fs.provider)
      const dir = await store.create('r1')
      await dir.writeMeeting({ ...meeting, media: { audio: { mimeType: 'audio/webm' } } })
      if (missing === 'directory') await store.remove('r1')
      if (missing === 'declaredTrack') await dir.writeManifest(manifest({}))
      if (missing === 'invalidManifest') {
        const file = await dir.handle.getFileHandle('manifest.json', { create: true })
        const writer = await file.createWritable()
        await writer.write('{}')
        await writer.close()
      }
      if (missing === 'unreadableManifest') {
        vi.spyOn(dir.handle, 'getFileHandle').mockRejectedValueOnce(new Error('read failed'))
      }
      await expect(recordingSource(store).readMedia('r1')).rejects.toMatchObject({
        code: 'sourceDataUnavailable',
      })
    },
  )
})
