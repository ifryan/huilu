/**
 * 会后处理任务（每场会议最多一个），持久化在 IndexedDB，浏览器重启后继续。
 *
 * - queued：等待执行（含失败后等待自动重试，见 nextAttemptAt）
 * - running：正在执行；离屏文档被关闭 / 浏览器退出后重新打开时改回 queued
 * - waitingFolder：逐字稿 / 纪要已生成并保存在 OPFS，数据文件夹未授权，等待在可见页面重新授权后补写
 * - failed：需要用户处理（改配置后手动重试），或自动重试次数用完
 * - done：结果已写入数据文件夹
 */
export type JobState = 'queued' | 'running' | 'waitingFolder' | 'failed' | 'done'

export const PIPELINE_STEPS = ['transcribe', 'summarize', 'write'] as const
export type StepId = (typeof PIPELINE_STEPS)[number]

/**
 * 失败原因。服务商错误沿用 ProviderErrorCode（i18n：providers.error.<code>），
 * 其余为处理管线自己的原因（i18n：processing.error.<code>）
 */
export const PIPELINE_ERROR_CODES = [
  'transcriptionNotConfigured',
  'unknownProvider',
  'hostPermission',
  'noAudio',
  'meetingNotFound',
  'splitFailed',
  'writeFailed',
  'sourceDataUnavailable',
  'unknown',
] as const
export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number]

export interface JobError {
  step: StepId
  /** ProviderErrorCode 或 PipelineErrorCode */
  code: string
  /** 服务商 / 浏览器给出的原始说明（不含 Key） */
  detail?: string
  /** 是否会自动重试（此时任务仍为 queued） */
  retryable: boolean
}

/** 没有生成纪要的原因：大模型未配置 / 服务商未知 / 未授予域名权限 / 逐字稿为空 */
export const SUMMARY_SKIP_REASONS = [
  'notConfigured',
  'unknownProvider',
  'hostPermission',
  'emptyTranscript',
] as const
export type SummarySkipReason = (typeof SUMMARY_SKIP_REASONS)[number]

export interface ProcessingJob {
  meetingId: string
  state: JobState
  /** 当前 / 最近执行的步骤 */
  step?: StepId
  /** 当前步骤进度 0–1（服务商给出时才有） */
  progress?: number
  /** 本轮自动执行的次数；手动重试时清零 */
  attempts: number
  /** 自动重试时间（epoch 毫秒） */
  nextAttemptAt?: number
  error?: JobError
  summary?: { state: 'done' } | { state: 'skipped'; reason: SummarySkipReason }
  /** 写入数据文件夹时使用的子文件夹名，第一次写入时确定，重试沿用 */
  folderDir?: string
  /** 曾完成最终目录提交；后续补处理必须从该目录读取权威数据。兼容旧 done 任务。 */
  folderCommitted?: boolean
  transcriptionProviderId?: string
  llmProviderId?: string
  /** 服务商断点（上传地址、任务号、切片位置……），键为 `<步骤>:<服务商>[:<切片>]` */
  checkpoints: Record<string, unknown>
  createdAt: number
  updatedAt: number
  finishedAt?: number
}

/** 仍需要离屏文档保持运行的任务 */
export const isActive = (job: Pick<ProcessingJob, 'state'>) =>
  job.state === 'queued' || job.state === 'running'

export type EnqueueResult =
  | { queued: true; job: ProcessingJob }
  | { queued: false; reason: 'noAudio' | 'notConfigured' | 'meetingNotFound' | 'notProcessing' }
