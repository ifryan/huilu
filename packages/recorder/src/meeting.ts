import { MEETING_SCHEMA_VERSION, Meeting } from '@huilu/core'
import type { RecordingManifest } from './manifest'

/** 至少一条轨道写成了分片：才有值得保留的内容 */
export function hasRecordedData(m: Pick<RecordingManifest, 'tracks'>): boolean {
  return Object.values(m.tracks).some((t) => (t?.chunks ?? 0) > 0)
}

/**
 * 录制结束后生成 meeting.json。有转写音频时状态为 processing，交给会后处理管线；
 * 只剩视频时照样保留（可预览、可恢复），但状态为 failed，不会被当作可转写。
 */
export function meetingFromManifest(m: RecordingManifest): Meeting {
  const video = m.mode === 'video' && m.tracks.video?.chunks ? m.tracks.video : undefined
  const audio = m.tracks.audio?.chunks ? m.tracks.audio : undefined
  if (!video && !audio) throw new Error(`recording ${m.id} has no recorded data`)
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
    status: audio ? 'processing' : 'failed',
    providers: {},
    media: {
      video: video ? { mimeType: video.mimeType, ...m.video } : undefined,
      audio: audio ? { mimeType: audio.mimeType } : undefined,
    },
  })
}
