import {
  RecordingStore,
  extensionForMime,
  listLocalRecordings,
  previewTrack,
  type LocalRecording,
} from '@huilu/recorder'
import { useQuery } from '@tanstack/react-query'

/** 插件页面与离屏文档、录制窗口同源，读到的是同一个 OPFS */
export const listRecordings = () => listLocalRecordings(store)

const store = new RecordingStore(() => navigator.storage.getDirectory())

export const libraryKey = ['localRecordings'] as const

export function useLocalRecordings() {
  return useQuery({
    queryKey: libraryKey,
    queryFn: () => listLocalRecordings(store),
    // 没有录制行时也要发现后台刚结束的录制；可见页面才轮询。
    refetchInterval: 3000,
  })
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

export async function openRecordingTrack(
  recording: LocalRecording,
  track: 'audio' | 'video',
): Promise<Blob | undefined> {
  const info = recording.tracks[track]
  const dir = await store.open(recording.id)
  if (!info?.chunks || !dir) return undefined
  return dir.readTrack(track, info.chunks, info.mimeType.split(';')[0]!)
}
