import { resources } from '@huilu/i18n'
import {
  PIPELINE_ERROR_CODES,
  PIPELINE_STEPS,
  SUMMARY_SKIP_REASONS,
  type ProcessingJob,
} from '@huilu/pipeline/jobs'
import { describe, expect, it } from 'vitest'
import { errorKey, processingView } from './processing-view'

const recording = {
  state: 'saved' as const,
  transcribable: true,
  processing: 'processing' as const,
}
const ready = { transcription: true, llm: true, folder: 'granted' as const }
const job = (overrides: Partial<ProcessingJob>): ProcessingJob => ({
  meetingId: 'm',
  state: 'queued',
  attempts: 0,
  checkpoints: {},
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

describe('processingView', () => {
  it('hides processing for interrupted or unreadable recordings', () => {
    expect(processingView({ ...recording, state: 'unfinished' }, undefined, ready).kind).toBe(
      'none',
    )
    expect(processingView({ ...recording, state: 'damaged' }, undefined, ready).kind).toBe('none')
  })

  it('never offers transcription for recordings without transcription audio', () => {
    expect(processingView({ ...recording, transcribable: false }, undefined, ready)).toEqual({
      kind: 'noAudio',
    })
  })

  it('offers 补转写 only when the transcription service is ready', () => {
    expect(processingView(recording, undefined, ready)).toEqual({
      kind: 'idle',
      canStart: true,
      transcriptOnly: false,
    })
    expect(processingView(recording, undefined, { ...ready, llm: false })).toMatchObject({
      canStart: true,
      transcriptOnly: true,
    })
    expect(processingView(recording, undefined, { ...ready, transcription: false })).toMatchObject({
      canStart: false,
    })
  })

  it('shows automatic retries and running progress', () => {
    const error = { step: 'transcribe' as const, code: 'rateLimited', retryable: true }
    expect(processingView(recording, job({ error, nextAttemptAt: 5 }), ready)).toEqual({
      kind: 'retrying',
      error,
      at: 5,
    })
    expect(
      processingView(recording, job({ state: 'running', step: 'summarize', progress: 0.5 }), ready),
    ).toEqual({ kind: 'running', step: 'summarize', progress: 0.5 })
  })

  it('asks for folder authorization when results wait to be written', () => {
    expect(
      processingView(recording, job({ state: 'waitingFolder' }), { ...ready, folder: 'prompt' }),
    ).toEqual({ kind: 'waitingFolder', permission: 'prompt' })
  })

  it('allows retrying transcription failures once the service is ready again', () => {
    const failed = job({
      state: 'failed',
      error: { step: 'transcribe', code: 'transcriptionNotConfigured', retryable: false },
    })
    expect(processingView(recording, failed, { ...ready, transcription: false })).toMatchObject({
      canRetry: false,
    })
    expect(processingView(recording, failed, ready)).toMatchObject({ canRetry: true })
  })

  it('offers the summary later when it was skipped for configuration reasons', () => {
    const done = (reason: (typeof SUMMARY_SKIP_REASONS)[number]) =>
      job({ state: 'done', folderDir: 'd', summary: { state: 'skipped', reason } })
    expect(processingView(recording, done('notConfigured'), ready)).toEqual({
      kind: 'done',
      folderDir: 'd',
      summarySkipped: 'notConfigured',
      canSummarize: true,
    })
    expect(processingView(recording, done('emptyTranscript'), ready)).toMatchObject({
      canSummarize: false,
    })
    expect(
      processingView(recording, done('notConfigured'), { ...ready, llm: false }),
    ).toMatchObject({ canSummarize: false })
  })
})

describe('processing i18n keys', () => {
  const lookup = (tree: unknown, key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree)
  const keys = [
    ...PIPELINE_ERROR_CODES.map(errorKey),
    ...['rateLimited', 'unauthorized', 'taskFailed', 'fileTooLarge'].map(errorKey),
    ...SUMMARY_SKIP_REASONS.map((r) => `processing.summarySkipped.${r}`),
    ...PIPELINE_STEPS.flatMap((s) => [`processing.step.${s}`, `processing.stepName.${s}`]),
    ...['noAudio', 'notConfigured', 'meetingNotFound', 'notProcessing'].map(
      (r) => `processing.notQueued.${r}`,
    ),
  ]

  it.each(keys)('%s exists in every locale', (key) => {
    for (const locale of Object.values(resources)) {
      expect(typeof lookup(locale.translation, key)).toBe('string')
    }
  })

  it('maps provider errors to providers.error.*', () => {
    expect(errorKey('rateLimited')).toBe('providers.error.rateLimited')
    expect(errorKey('noAudio')).toBe('processing.error.noAudio')
  })
})
