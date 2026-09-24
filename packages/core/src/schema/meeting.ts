import { z } from 'zod'

/** 当前数据格式版本。修改 meeting.json 结构时 +1，并在 migrations.ts 中补充迁移。 */
export const MEETING_SCHEMA_VERSION = 1

export const RecordingMode = z.enum(['audio', 'video'])
export type RecordingMode = z.infer<typeof RecordingMode>

export const VideoSource = z.enum(['tab', 'window', 'screen'])
export type VideoSource = z.infer<typeof VideoSource>

export const Speaker = z.object({
  id: z.string(),
  name: z.string(),
})
export type Speaker = z.infer<typeof Speaker>

export const Marker = z.object({
  id: z.string(),
  /** 距录制开始的毫秒数 */
  atMs: z.number().int().nonnegative(),
  label: z.string().optional(),
})
export type Marker = z.infer<typeof Marker>

/** 录制时实际使用的编码（按浏览器支持情况探测得到，见 ADR 0004 第 3 节） */
export const MeetingMedia = z.object({
  video: z
    .object({
      mimeType: z.string(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
    })
    .optional(),
  /**
   * 转写用的低码率纯音频。缺失表示转写音轨没有录到数据（只保留了视频）：这场会议不能转写，
   * status 为 failed。放宽为可选不影响已有的 meeting.json
   */
  audio: z.object({ mimeType: z.string() }).optional(),
})
export type MeetingMedia = z.infer<typeof MeetingMedia>

export const ProcessingStatus = z.enum(['recording', 'processing', 'ready', 'failed'])
export type ProcessingStatus = z.infer<typeof ProcessingStatus>

/** 每场会议文件夹中的 meeting.json */
export const Meeting = z.object({
  schemaVersion: z.literal(MEETING_SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  mode: RecordingMode,
  videoSource: VideoSource.optional(),
  language: z.string(),
  speakers: z.array(Speaker).default([]),
  markers: z.array(Marker).default([]),
  status: ProcessingStatus,
  /** 录制产物的编码信息；导入的外部文件可能没有 */
  media: MeetingMedia.optional(),
  /** 该会议生成时使用的服务商，便于复现与重新生成 */
  providers: z
    .object({
      transcription: z.string().optional(),
      llm: z.string().optional(),
    })
    .default({}),
})
export type Meeting = z.infer<typeof Meeting>
