import type { z } from 'zod'
import type { Transcript } from '../schema/transcript'

export interface TaskContext {
  signal: AbortSignal
  /** 0–1 */
  onProgress?: (progress: number) => void
}

export interface AudioInput {
  blob: Blob
  mimeType: string
  durationMs: number
  language: string
}

export interface TranscriptionProvider<Config = unknown> {
  id: string
  /** i18n key，例如 'providers.paraformer.name' */
  nameKey: string
  /** 设置页根据该 schema 生成表单并校验 */
  configSchema: z.ZodType<Config>
  capabilities: {
    diarization: boolean
    /** 单文件大小上限；超出时由处理管线自动切片 */
    maxFileBytes?: number
    languages: string[]
  }
  testConnection(config: Config, ctx: TaskContext): Promise<void>
  transcribe(input: AudioInput, config: Config, ctx: TaskContext): Promise<Transcript>
}
