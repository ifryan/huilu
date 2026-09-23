import type { Exporter } from './extension-points/exporter'
import type { LlmProvider, SummaryTemplate } from './extension-points/llm'
import type { PipelineStep } from './extension-points/pipeline'
import type { StorageAdapter } from './extension-points/storage'
import type { TranscriptionProvider } from './extension-points/transcription'
import { Registry } from './registry'

/** 全局扩展点注册表 */
export const registries = {
  transcription: new Registry<TranscriptionProvider>('transcription provider'),
  llm: new Registry<LlmProvider>('llm provider'),
  storage: new Registry<StorageAdapter>('storage adapter'),
  pipeline: new Registry<PipelineStep>('pipeline step'),
  exporter: new Registry<Exporter>('exporter'),
  summaryTemplate: new Registry<SummaryTemplate>('summary template'),
}
