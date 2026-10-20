// 历史记录中每场录制的处理状态（纯逻辑，便于单元测试）
import type { FolderPermission } from '@huilu/storage'
import type { JobError, ProcessingJob, StepId, SummarySkipReason } from '@huilu/pipeline/jobs'
import { PROVIDER_ERROR_CODES } from '@huilu/providers'
import type { LocalRecording } from '@huilu/recorder'

export type ProcessingView =
  /** 录制中断未恢复 / 无法读取：不显示处理状态 */
  | { kind: 'none' }
  /** 只有视频、没有转写音频：不能转写 */
  | { kind: 'noAudio' }
  /** 还没处理。canStart：转写服务已就绪；transcriptOnly：大模型未就绪，只会生成逐字稿 */
  | { kind: 'idle'; canStart: boolean; transcriptOnly: boolean }
  /** 早期数据：meeting.json 已是 ready 但没有任务记录 */
  | { kind: 'ready' }
  | { kind: 'queued' }
  | { kind: 'retrying'; error: JobError; at: number }
  | { kind: 'running'; step: StepId; progress?: number }
  | { kind: 'waitingFolder'; permission: FolderPermission }
  | { kind: 'failed'; error: JobError; canRetry: boolean }
  | {
      kind: 'done'
      folderDir?: string
      summarySkipped?: SummarySkipReason
      /** 纪要被跳过而大模型现在已就绪：可以补生成 */
      canSummarize: boolean
    }

export interface ProcessingReadiness {
  transcription: boolean
  llm: boolean
  folder: FolderPermission
}

/** 就绪状态 → 历史行需要的部分；由历史页统一查询一次后传给每一行 */
export function processingReadiness(
  readiness:
    { transcription: boolean; llm: boolean; folder: { permission: FolderPermission } } | undefined,
): ProcessingReadiness | undefined {
  return (
    readiness && {
      transcription: readiness.transcription,
      llm: readiness.llm,
      folder: readiness.folder.permission,
    }
  )
}

export function processingView(
  recording: Pick<LocalRecording, 'state' | 'transcribable' | 'processing'>,
  job: ProcessingJob | undefined,
  readiness: ProcessingReadiness | undefined,
): ProcessingView {
  if (recording.state === 'damaged' || recording.state === 'unfinished') return { kind: 'none' }
  if (!recording.transcribable) return { kind: 'noAudio' }
  if (!job) {
    if (recording.processing === 'ready') return { kind: 'ready' }
    return {
      kind: 'idle',
      canStart: readiness?.transcription ?? false,
      transcriptOnly: readiness ? !readiness.llm : false,
    }
  }
  switch (job.state) {
    case 'queued':
      return job.error && job.nextAttemptAt
        ? { kind: 'retrying', error: job.error, at: job.nextAttemptAt }
        : { kind: 'queued' }
    case 'running':
      return { kind: 'running', step: job.step ?? 'transcribe', progress: job.progress }
    case 'waitingFolder':
      return { kind: 'waitingFolder', permission: readiness?.folder ?? 'prompt' }
    case 'failed': {
      const error = job.error ?? {
        step: job.step ?? 'transcribe',
        code: 'unknown',
        retryable: false,
      }
      // 转写配置类的问题：服务就绪（用户已改好设置）后才能重试；其他错误随时可以重试
      const needsTranscription = error.step === 'transcribe'
      return {
        kind: 'failed',
        error,
        canRetry: needsTranscription ? (readiness?.transcription ?? false) : true,
      }
    }
    case 'done': {
      const skipped = job.summary?.state === 'skipped' ? job.summary.reason : undefined
      return {
        kind: 'done',
        folderDir: job.folderDir,
        summarySkipped: skipped,
        canSummarize:
          skipped !== undefined && skipped !== 'emptyTranscript' && (readiness?.llm ?? false),
      }
    }
  }
}

/** 错误原因的 i18n key：服务商错误 providers.error.*，处理管线自己的错误 processing.error.* */
export function errorKey(code: string): string {
  return (PROVIDER_ERROR_CODES as readonly string[]).includes(code)
    ? `providers.error.${code}`
    : `processing.error.${code}`
}
