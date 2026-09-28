import type { z } from 'zod'
import type { Transcript } from '../schema/transcript'

export interface TaskContext {
  signal: AbortSignal
  /** 0–1 */
  onProgress?: (progress: number) => void
}

/**
 * 断点：服务商把「已上传的文件地址、已提交的任务号」等中间状态交给处理管线持久化，
 * 重试 / 浏览器重启后从这里继续，避免重复上传、重复计费。值必须能 JSON 序列化
 */
export interface Checkpoint {
  get(): unknown
  set(value: unknown): Promise<void>
}

export interface TranscriptionContext extends TaskContext {
  checkpoint?: Checkpoint
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
  transcribe(input: AudioInput, config: Config, ctx: TranscriptionContext): Promise<Transcript>
}
