import type { Exporter } from './extension-points/exporter'
import type { LlmProvider, SummaryTemplate } from './extension-points/llm'
import type { PipelineStep } from './extension-points/pipeline'
import type { StorageAdapter } from './extension-points/storage'
import type { TranscriptionProvider } from './extension-points/transcription'
import { Registry } from './registry'
import { generalSummaryTemplate } from './summary-templates/general'

/** 全局扩展点注册表 */
export const registries = {
  transcription: new Registry<TranscriptionProvider>('transcription provider'),
  llm: new Registry<LlmProvider>('llm provider'),
  storage: new Registry<StorageAdapter>('storage adapter'),
  pipeline: new Registry<PipelineStep>('pipeline step'),
  exporter: new Registry<Exporter>('exporter'),
  // 不同模板的输出结构不同，注册表按 unknown 存放；取出后以 outputSchema 校验得到的结果为准
  summaryTemplate: new Registry<SummaryTemplate<unknown>>('summary template'),
}

// 内置实现在这里登记，使用方通过 list() 即可发现
registries.summaryTemplate.register(generalSummaryTemplate)
