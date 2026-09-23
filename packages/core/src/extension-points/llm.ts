import type { z } from 'zod'
import type { TaskContext } from './transcription'

export interface LlmProvider<Config = unknown> {
  id: string
  nameKey: string
  configSchema: z.ZodType<Config>
  testConnection(config: Config, ctx: TaskContext): Promise<void>
  /** 按给定 schema 生成结构化结果（纪要、章节等） */
  generateObject<T>(
    request: { system: string; prompt: string; schema: z.ZodType<T> },
    config: Config,
    ctx: TaskContext,
  ): Promise<T>
}

/** 纪要模板 = Prompt + 输出 schema，新增模板无需改代码逻辑 */
export interface SummaryTemplate {
  id: string
  nameKey: string
  systemPrompt: (locale: string) => string
}
