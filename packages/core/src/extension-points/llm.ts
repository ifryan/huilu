import type { z } from 'zod'
import type { Summary } from '../schema/summary'
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

/**
 * 纪要模板 = Prompt + 输出 schema，新增模板无需改代码逻辑。
 * outputSchema 直接交给 LlmProvider.generateObject，生成结果的类型由它推导。
 */
export interface SummaryTemplate<T = Summary> {
  id: string
  nameKey: string
  systemPrompt: (locale: string) => string
  outputSchema: z.ZodType<T>
}

/** 模板的输出类型 */
export type SummaryTemplateOutput<Template> = Template extends SummaryTemplate<infer T> ? T : never

/** 定义模板并保留输出类型推导：defineSummaryTemplate({ ..., outputSchema: WeeklySummary }) */
export function defineSummaryTemplate<T>(template: SummaryTemplate<T>): SummaryTemplate<T> {
  return template
}
