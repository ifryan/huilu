import { z } from 'zod'

export const VideoResolution = z.enum(['720p', '1080p'])
export type VideoResolution = z.infer<typeof VideoResolution>

export const VideoFps = z.union([z.literal(15), z.literal(30)])
export type VideoFps = z.infer<typeof VideoFps>

export const VideoQuality = z.object({ resolution: VideoResolution, fps: VideoFps })
export type VideoQuality = z.infer<typeof VideoQuality>

export const DEFAULT_VIDEO_QUALITY: VideoQuality = { resolution: '720p', fps: 15 }

const HEIGHT: Record<VideoResolution, number> = { '720p': 720, '1080p': 1080 }

/**
 * 视频码率上限。会议多为屏幕共享（静态画面多），H.264 实际码率通常只有上限的一半左右
 * （ADR 0004：4Mbps 上限实测约 2Mbps）。
 */
const VIDEO_BITRATE: Record<VideoResolution, Record<VideoFps, number>> = {
  '720p': { 15: 1_000_000, 30: 1_500_000 },
  '1080p': { 15: 2_000_000, 30: 3_000_000 },
}

/** 视频文件里的音轨 */
export const VIDEO_AUDIO_BITRATE = 128_000
/** 转写用纯音频：Opus 24kbps，实测约 7MB/小时（ADR 0004 第 4 节） */
export const TRANSCRIPT_AUDIO_BITRATE = 24_000

/** MediaRecorder 分片间隔：每 5 秒一个分片写入 OPFS */
export const TIMESLICE_MS = 5000
/** MP4 只能在关键帧处切分片，不设置时分片间隔可达 11 秒（ADR 0004 第 2 节） */
export const KEYFRAME_INTERVAL_MS = 1000

export function videoDimensions({ resolution }: VideoQuality) {
  const height = HEIGHT[resolution]
  return { width: Math.round((height * 16) / 9), height }
}

export function videoBitrate({ resolution, fps }: VideoQuality): number {
  return VIDEO_BITRATE[resolution][fps]
}

/** 每小时占用空间上限（字节）：视频模式 = 视频 + 视频音轨 + 转写音频；仅音频 = 转写音频 */
export function estimateBytesPerHour(quality: VideoQuality | null): number {
  const bps = quality
    ? videoBitrate(quality) + VIDEO_AUDIO_BITRATE + TRANSCRIPT_AUDIO_BITRATE
    : TRANSCRIPT_AUDIO_BITRATE
  return Math.round((bps / 8) * 3600)
}
