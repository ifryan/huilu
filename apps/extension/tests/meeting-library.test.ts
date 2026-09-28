import { describe, expect, it, vi } from 'vitest'
import { Meeting } from '@huilu/core'
import { resultMedia, resultMediaInfo, type ResultDocument } from '@/lib/meeting-library'

const { openTrack } = vi.hoisted(() => {
  vi.stubGlobal('indexedDB', {})
  return { openTrack: vi.fn() }
})
vi.mock('@/lib/library', () => ({ listRecordings: vi.fn(), openRecordingTrack: openTrack }))

function document(): ResultDocument {
  return {
    meeting: Meeting.parse({
      schemaVersion: 1,
      id: 'legacy',
      title: 'Legacy',
      createdAt: '2026-09-28T00:00:00Z',
      durationMs: 1000,
      mode: 'video',
      language: 'en',
      status: 'processing',
    }),
    dir: 'legacy',
    source: 'local',
    readOnly: true,
    warnings: [],
    local: {
      id: 'legacy',
      title: 'Legacy',
      state: 'saved',
      durationMs: 1000,
      bytes: 20,
      transcribable: true,
      tracks: {
        video: { mimeType: 'video/mp4', chunks: 1, bytes: 10 },
        audio: { mimeType: 'audio/webm;codecs=opus', chunks: 1, bytes: 10 },
      },
    },
  }
}

describe('result media source metadata', () => {
  it.each(['audio', 'video'] as const)(
    'opens legacy OPFS %s without meeting.media',
    async (kind) => {
      const doc = document()
      const blob = new Blob(['media'], { type: doc.local!.tracks[kind]!.mimeType })
      openTrack.mockResolvedValueOnce(blob)
      expect(resultMediaInfo(doc, kind)?.mimeType).toBe(doc.local!.tracks[kind]!.mimeType)
      expect(await resultMedia(doc, kind)).toBe(blob)
      expect(openTrack).toHaveBeenLastCalledWith(doc.local, kind)
    },
  )
  it('uses OPFS track MIME for the bytes actually opened, even with stale meeting metadata', () => {
    const doc = document()
    doc.meeting.media = { video: { mimeType: 'video/webm' } }
    expect(resultMediaInfo(doc, 'video')?.mimeType).toBe('video/mp4')
  })
  it('does not use retained OPFS media to replace missing final-folder media', async () => {
    const doc = { ...document(), source: 'folder' as const }
    expect(resultMediaInfo(doc, 'video')).toBeUndefined()
    expect(await resultMedia(doc, 'video')).toBeUndefined()
    doc.meeting.media = { audio: { mimeType: 'audio/mp4' } }
    expect(resultMediaInfo(doc, 'audio')?.mimeType).toBe('audio/mp4')
  })
  it('keeps absent and empty tracks unavailable despite stale meeting metadata', async () => {
    const doc = document()
    doc.meeting.media = { video: { mimeType: 'video/mp4' }, audio: { mimeType: 'audio/webm' } }
    delete doc.local!.tracks.video
    doc.local!.tracks.audio!.chunks = 0
    expect(resultMediaInfo(doc, 'video')).toBeUndefined()
    expect(resultMediaInfo(doc, 'audio')).toBeUndefined()
    expect(await resultMedia(doc, 'video')).toBeUndefined()
    expect(await resultMedia(doc, 'audio')).toBeUndefined()
  })
})
