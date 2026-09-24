import { MEETING_SCHEMA_VERSION, Meeting } from '@huilu/core'
import type { RecordingManifest } from './manifest'

/** 录制结束后生成 meeting.json：状态为 processing，交给会后处理管线 */
export function meetingFromManifest(m: RecordingManifest): Meeting {
  const video = m.mode === 'video' && m.tracks.video?.chunks ? m.tracks.video : undefined
  const audio = m.tracks.audio
  if (!audio) throw new Error(`recording ${m.id} has no audio track`)
  return Meeting.parse({
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: m.id,
    title: m.title,
    createdAt: new Date(m.startedAt).toISOString(),
    durationMs: Math.round(m.activeMs),
    mode: m.mode,
    videoSource: m.mode === 'video' ? m.videoSource : undefined,
    language: m.language,
    speakers: [],
    markers: [],
    status: 'processing',
    providers: {},
    media: {
      video: video ? { mimeType: video.mimeType, ...m.video } : undefined,
      audio: { mimeType: audio.mimeType },
    },
  })
}
