/**
 * 编码格式探测（ADR 0004 第 3 节）：按顺序取浏览器支持的第一个。
 * AAC 只有 Windows / macOS 的 Chrome 有，Linux 退回 H.264 + Opus；实际使用的 MIME 写进 meeting.json。
 */
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4;codecs=avc1.640028,opus',
  'video/mp4;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const

/** 转写用纯音频：WebM/Opus 体积最小，百炼与 OpenAI 兼容接口都接受 */
export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=opus',
  'audio/webm',
] as const

export type IsTypeSupported = (mimeType: string) => boolean

export function pickMimeType(
  candidates: readonly string[],
  isTypeSupported: IsTypeSupported,
): string | undefined {
  return candidates.find((t) => isTypeSupported(t))
}

/** 分片拼接后成品文件的扩展名 */
export function extensionForMime(mimeType: string): 'mp4' | 'webm' {
  return mimeType.split(';')[0]?.trim().endsWith('/mp4') ? 'mp4' : 'webm'
}
