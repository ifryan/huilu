import type { ProcessingStatus, RecordingMode, VideoSource } from '@huilu/core'
import { isUnfinished, type TrackName } from './manifest'
import type { RecordingStore } from './store'

/**
 * - saved：正常结束，meeting.json 已生成
 * - partial：已保存，但收尾出错（写入失败 / 录制器超时 / 缺视频轨），内容可能不完整
 * - unfinished：意外中断（浏览器崩溃、录制窗口被关闭），可在弹窗 / 侧边栏里恢复
 * - damaged：目录还在但 manifest 读不出来；只列出来，不做任何修改
 */
export type LocalRecordingState = 'saved' | 'partial' | 'unfinished' | 'damaged'

export interface LocalRecordingTrack {
  mimeType: string
  chunks: number
  bytes: number
}

/** OPFS 中一场录制的概要，历史列表用；只读，不修改任何文件 */
export interface LocalRecording {
  id: string
  title: string
  state: LocalRecordingState
  mode?: RecordingMode
  videoSource?: VideoSource
  startedAt?: number
  durationMs: number
  bytes: number
  error?: string
  /** meeting.json 中的处理状态；没有 meeting.json 时为空 */
  processing?: ProcessingStatus
  /** 有转写音频分片；为 false 时只能预览视频，不能转写 */
  transcribable: boolean
  tracks: Partial<Record<TrackName, LocalRecordingTrack>>
}

/**
 * 列出 OPFS 中所有录制（最新在前）。与是否配置转写服务、是否选择数据文件夹无关：
 * 录制只写 OPFS，这里是它们在转写 / 写入文件夹之前唯一能被找到的地方。
 */
export async function listLocalRecordings(store: RecordingStore): Promise<LocalRecording[]> {
  const out: LocalRecording[] = []
  for (const id of (await store.list()).reverse()) {
    const dir = await store.open(id)
    const manifest = await dir?.readManifest()
    if (!dir || !manifest) {
      out.push({
        id,
        title: id,
        state: 'damaged',
        durationMs: 0,
        bytes: 0,
        transcribable: false,
        tracks: {},
      })
      continue
    }
    const meeting = await dir.readMeeting().catch(() => undefined)
    const tracks: LocalRecording['tracks'] = {}
    for (const [name, t] of Object.entries(manifest.tracks)) {
      if (t) tracks[name as TrackName] = { mimeType: t.mimeType, chunks: t.chunks, bytes: t.bytes }
    }
    out.push({
      id,
      title: manifest.title,
      state: isUnfinished(manifest)
        ? 'unfinished'
        : manifest.endReason === 'error' || manifest.error
          ? 'partial'
          : 'saved',
      mode: manifest.mode,
      videoSource: manifest.videoSource,
      startedAt: manifest.startedAt,
      durationMs: Math.round(manifest.activeMs),
      bytes: Object.values(tracks).reduce((sum, t) => sum + t.bytes, 0),
      error: manifest.error,
      processing: meeting?.status,
      transcribable: (tracks.audio?.chunks ?? 0) > 0,
      tracks,
    })
  }
  return out
}

/** 预览 / 下载用的轨道：有视频就用视频（带声音），否则用转写音频 */
export function previewTrack(recording: LocalRecording): TrackName | undefined {
  if (recording.tracks.video?.chunks) return 'video'
  if (recording.tracks.audio?.chunks) return 'audio'
  return undefined
}
