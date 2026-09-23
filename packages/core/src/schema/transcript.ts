import { z } from 'zod'

export const TranscriptSegment = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  /** 不支持发言人区分的服务商统一返回同一个 speakerId */
  speakerId: z.string(),
  text: z.string(),
})
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

/** transcript.json */
export const Transcript = z.object({
  language: z.string(),
  segments: z.array(TranscriptSegment),
})
export type Transcript = z.infer<typeof Transcript>
