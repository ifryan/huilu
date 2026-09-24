import { RecordingMode, VideoSource } from '@huilu/core'
import { z } from 'zod'
import { VideoQuality } from './quality'

export const TrackName = z.enum(['video', 'audio'])
export type TrackName = z.infer<typeof TrackName>

export const EndReason = z.enum(['user', 'source-ended', 'error', 'recovered'])
export type EndReason = z.infer<typeof EndReason>

/**
 * - recording / paused：正在录制；离屏文档不在录制它却看到这两种状态，说明录制被意外中断，可恢复
 * - stopped：已收尾，meeting.json 已生成，等待处理管线
 */
export const RecordingState = z.enum(['recording', 'paused', 'stopped'])
export type RecordingState = z.infer<typeof RecordingState>

export const TrackManifest = z.object({
  mimeType: z.string(),
  /** 已写入且校验通过的分片数，分片文件名为 000001.part 起连续编号 */
  chunks: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sizes: z.array(z.number().int().positive()),
})
export type TrackManifest = z.infer<typeof TrackManifest>

/**
 * OPFS 中每个录制的 manifest.json：每写完一个分片就更新一次，
 * 浏览器崩溃后据此恢复（分片数、时长只会比实际少最后一个分片）。
 */
export const RecordingManifest = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  mode: RecordingMode,
  videoSource: VideoSource,
  language: z.string(),
  microphone: z.boolean(),
  quality: VideoQuality.optional(),
  video: z
    .object({
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
    })
    .optional(),
  state: RecordingState,
  /** 开始录制的时间（epoch 毫秒） */
  startedAt: z.number(),
  updatedAt: z.number(),
  /** 不含暂停的实际录制时长 */
  activeMs: z.number().nonnegative(),
  endReason: EndReason.optional(),
  error: z.string().optional(),
  tracks: z.partialRecord(TrackName, TrackManifest),
})
export type RecordingManifest = z.infer<typeof RecordingManifest>

export function isUnfinished(m: Pick<RecordingManifest, 'state'>): boolean {
  return m.state === 'recording' || m.state === 'paused'
}
