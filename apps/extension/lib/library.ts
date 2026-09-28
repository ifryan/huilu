import {
  RecordingStore,
  extensionForMime,
  listLocalRecordings,
  previewTrack,
  type LocalRecording,
} from '@huilu/recorder'
import { useQuery } from '@tanstack/react-query'

/** 插件页面与离屏文档、录制窗口同源，读到的是同一个 OPFS */
const store = new RecordingStore(() => navigator.storage.getDirectory())

export const libraryKey = ['localRecordings'] as const

export function useLocalRecordings() {
  return useQuery({ queryKey: libraryKey, queryFn: () => listLocalRecordings(store) })
}

/** 按分片拼出可播放 / 下载的文件（File 是惰性的，不会把整段读进内存） */
export async function openRecordingMedia(
  recording: LocalRecording,
): Promise<{ blob: Blob; fileName: string; kind: 'video' | 'audio' } | undefined> {
  const track = previewTrack(recording)
  const info = track && recording.tracks[track]
  const dir = await store.open(recording.id)
  if (!track || !info || !dir) return undefined
  const type = info.mimeType.split(';')[0]!
  const blob = await dir.readTrack(track, info.chunks, type)
  const safeTitle = recording.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || recording.id
  return {
    blob,
    fileName: `${safeTitle}.${extensionForMime(info.mimeType)}`,
    kind: track === 'video' ? 'video' : 'audio',
  }
}
