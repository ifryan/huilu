import { z } from 'zod'

export const Chapter = z.object({
  startMs: z.number().int().nonnegative(),
  title: z.string(),
  summary: z.string(),
})

export const SpeakerSummary = z.object({
  speakerId: z.string(),
  summary: z.string(),
})

export const ActionItem = z.object({
  text: z.string(),
  owner: z.string().optional(),
  due: z.string().optional(),
})

/** 纪要（导读）结构；大模型按此 schema 输出结构化结果，同时渲染为 summary.md */
export const Summary = z.object({
  keywords: z.array(z.string()),
  overview: z.string(),
  chapters: z.array(Chapter),
  speakerSummaries: z.array(SpeakerSummary),
  keyPoints: z.array(z.string()),
  actionItems: z.array(ActionItem),
})
export type Summary = z.infer<typeof Summary>
