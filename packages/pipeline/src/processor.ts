import {
  Meeting,
  Summary,
  Transcript,
  generalSummaryTemplate,
  type Checkpoint,
  type LlmProvider,
  type StorageAdapter,
  type TranscriptionProvider,
} from '@huilu/core'
import { ProviderError, isRetryable } from '@huilu/providers'
import { FolderNotReadyError, WriteVerificationError } from '@huilu/storage'
import { meetingFolderName } from './folder'
import {
  isActive,
  type EnqueueResult,
  type JobError,
  type JobStore,
  type PipelineErrorCode,
  type ProcessingJob,
  type StepId,
  type SummarySkipReason,
} from './jobs'
import type { AudioSplitter } from './split'
import { buildSummaryPrompt, normalizeSummary, renderSummaryMarkdown } from './summary'
import { mergeTranscripts, speakersFromTranscript, summaryLocale } from './transcript'

/** 处理管线自己的错误（配置缺失、没有音频……），服务商错误用 ProviderError */
export class PipelineError extends Error {
  override name = 'PipelineError'
  constructor(
    readonly code: PipelineErrorCode,
    readonly retryable = false,
    detail?: string,
  ) {
    super(detail ?? code)
  }
}

/** 录制在 OPFS 中的内容（由平台层基于 @huilu/recorder 的 RecordingStore 实现） */
export interface MeetingSource {
  readMeeting(id: string): Promise<Meeting | undefined>
  writeMeeting(id: string, meeting: Meeting): Promise<void>
  /** 转写音频轨；没有录到音频分片时为 undefined */
  readAudio(id: string): Promise<{ blob: Blob; mimeType: string } | undefined>
  /** 需要一并写进数据文件夹的音视频文件，例如 audio.webm、video.mp4 */
  readMedia(id: string): Promise<{ name: string; blob: Blob }[]>
}

export type ServiceIssue = 'notConfigured' | 'unknownProvider' | 'hostPermission'

export type ResolvedService<P> =
  { ok: true; provider: P; config: unknown } | { ok: false; issue: ServiceIssue }

/** 当前生效的转写 / 大模型服务（每次执行步骤前重新读取，设置变化立即生效；未知服务商不回退到默认） */
export interface ResolvedServices {
  transcription: ResolvedService<TranscriptionProvider>
  llm: ResolvedService<LlmProvider>
}

type Files = Pick<StorageAdapter, 'readFile' | 'writeFile'>

export interface ProcessingDeps {
  jobs: JobStore
  source: MeetingSource
  /** 中间结果（OPFS，路径以会议 id 开头）：逐字稿、纪要、切片结果。数据文件夹未授权时也不会丢 */
  work: Files
  /** 用户的数据文件夹 */
  folder: Files & Pick<StorageAdapter, 'isReady'>
  services(): Promise<ResolvedServices>
  splitter?: AudioSplitter
  now?: () => number
  /** 任务有变化（状态、进度）时回调，用于通知界面刷新 */
  onChange?: (job: ProcessingJob) => void
  /** 队列里没有待执行的任务了：后台据此关闭空闲的离屏文档 */
  onIdle?: () => void
}

/** 自动执行的最多次数（含第一次）；之后停在 failed，由用户手动重试 */
export const MAX_AUTO_ATTEMPTS = 4

/** 自动重试的等待时间：20s、40s、80s……最多 10 分钟；服务商给了 Retry-After 时取较大者 */
export function retryDelayMs(attempts: number, retryAfterMs?: number): number {
  const backoff = Math.min(10 * 60_000, 20_000 * 2 ** Math.max(0, attempts - 1))
  return Math.max(backoff, retryAfterMs ?? 0)
}

const WORK = {
  transcript: (id: string) => `${id}/transcript.json`,
  summary: (id: string) => `${id}/summary.json`,
  piece: (id: string, i: number) => `${id}/pieces/${String(i).padStart(3, '0')}.json`,
}

/** 切片上限：留出余量，避免编码 / 封装开销让切片刚好超限 */
const SPLIT_MARGIN = 0.9

async function readJson<T>(
  files: Files,
  path: string,
  parse: (v: unknown) => T,
): Promise<T | undefined> {
  const blob = await files.readFile(path)
  if (!blob) return undefined
  try {
    return parse(JSON.parse(await blob.text()))
  } catch {
    // 损坏的中间结果当作不存在，重新生成
    return undefined
  }
}

const toJson = (value: unknown) => JSON.stringify(value, null, 2)

export interface EnqueueOptions {
  /**
   * auto：录制刚结束时自动加入。只处理 status 为 processing、有转写音频、且已配置转写服务的会议；
   * 否则保持原样，等用户在历史记录中「补转写」
   */
  auto?: boolean
}

/**
 * 会后处理队列：转写 → 纪要 → 写入数据文件夹，在离屏文档中执行。
 *
 * - 一次只执行一个任务：避免并发上传、并发计费
 * - 每一步的结果先写 OPFS（transcript.json / summary.json），已完成的步骤不会重做；
 *   服务商的中间状态（上传地址、任务号、切片）写进任务断点，重试时不重复上传 / 计费
 * - 数据文件夹未授权：停在 waitingFolder，授权后 onFolderAuthorized() 补写
 * - 可重试的错误（限流、网络、服务端）自动退避重试，其余停在 failed 等用户处理
 */
export class ProcessingQueue {
  #pumping = false
  #kickAgain = false
  #timer?: ReturnType<typeof setTimeout>
  #current?: { meetingId: string; controller: AbortController }
  #started = false
  #stopped = false

  constructor(private readonly deps: ProcessingDeps) {}

  #now() {
    return (this.deps.now ?? Date.now)()
  }

  /** 离屏文档启动时调用：上次没跑完（running）的任务改回 queued 并继续 */
  async start(): Promise<void> {
    this.#stopped = false
    if (this.#started) return this.kick()
    this.#started = true
    for (const job of await this.deps.jobs.list()) {
      if (job.state === 'running') {
        await this.#save({ ...job, state: 'queued', attempts: Math.max(0, job.attempts - 1) })
      } else if (job.state === 'waitingFolder' && (await this.deps.folder.isReady())) {
        await this.#save({ ...job, state: 'queued', nextAttemptAt: undefined })
      }
    }
    this.kick()
  }

  /** 是否还有需要离屏文档保持运行的任务 */
  async isBusy(): Promise<boolean> {
    if (this.#current) return true
    return (await this.deps.jobs.list()).some(isActive)
  }

  list(): Promise<ProcessingJob[]> {
    return this.deps.jobs.list()
  }

  /**
   * 加入队列 / 手动重试。已在队列中或正在执行时直接返回现有任务；
   * 失败或已完成的任务重新排队：保留断点和 OPFS 中的中间结果，只补做缺少的步骤
   */
  async enqueue(meetingId: string, options: EnqueueOptions = {}): Promise<EnqueueResult> {
    const meeting = await this.deps.source.readMeeting(meetingId)
    if (!meeting) return { queued: false, reason: 'meetingNotFound' }
    // 只有视频、没有转写音频（或旧数据标为 failed 且无音频）：不可转写，不上传静音
    if (!meeting.media?.audio || !(await this.deps.source.readAudio(meetingId))) {
      return { queued: false, reason: 'noAudio' }
    }
    if (options.auto) {
      if (meeting.status !== 'processing') return { queued: false, reason: 'notProcessing' }
      if (!(await this.deps.services()).transcription.ok) {
        return { queued: false, reason: 'notConfigured' }
      }
    }
    const existing = await this.deps.jobs.get(meetingId)
    if (existing && isActive(existing)) return { queued: true, job: existing }
    if (options.auto && existing) return { queued: true, job: existing }

    const now = this.#now()
    const job: ProcessingJob = {
      checkpoints: {},
      createdAt: now,
      ...existing,
      meetingId,
      state: 'queued',
      attempts: 0,
      nextAttemptAt: undefined,
      error: undefined,
      progress: undefined,
      finishedAt: undefined,
      updatedAt: now,
    }
    await this.#save(job)
    if (meeting.status !== 'processing') {
      await this.deps.source.writeMeeting(meetingId, { ...meeting, status: 'processing' })
    }
    this.kick()
    return { queued: true, job }
  }

  /** 数据文件夹重新授权后：等待写入的任务重新排队 */
  async onFolderAuthorized(): Promise<void> {
    if (!(await this.deps.folder.isReady())) return
    for (const job of await this.deps.jobs.list()) {
      if (job.state === 'waitingFolder') {
        await this.#save({ ...job, state: 'queued', nextAttemptAt: undefined })
      }
    }
    this.kick()
  }

  /** 停止正在执行的任务（离屏文档关闭前）；任务回到 queued，下次启动时继续 */
  stop(): void {
    this.#stopped = true
    clearTimeout(this.#timer)
    this.#current?.controller.abort()
  }

  /** 检查队列并执行到期的任务；并发调用只会有一个执行循环 */
  kick(): void {
    if (this.#stopped) return
    if (this.#pumping) {
      this.#kickAgain = true
      return
    }
    void this.#pump()
  }

  async #pump(): Promise<void> {
    this.#pumping = true
    clearTimeout(this.#timer)
    try {
      do {
        this.#kickAgain = false
        while (!this.#stopped) {
          const now = this.#now()
          const queued = (await this.deps.jobs.list())
            .filter((j) => j.state === 'queued')
            .sort((a, b) => a.createdAt - b.createdAt)
          const due = queued.find((j) => (j.nextAttemptAt ?? 0) <= now)
          if (!due) {
            const next = Math.min(...queued.map((j) => j.nextAttemptAt ?? now))
            if (queued.length > 0) {
              this.#timer = setTimeout(() => this.kick(), Math.max(1000, next - now))
            }
            break
          }
          await this.#run(due)
        }
      } while (this.#kickAgain)
    } catch (e) {
      console.error('[huilu] processing queue failed', e)
    } finally {
      this.#pumping = false
    }
    if (!(await this.isBusy().catch(() => true))) this.deps.onIdle?.()
  }

  async #save(job: ProcessingJob): Promise<void> {
    job.updatedAt = this.#now()
    await this.deps.jobs.put(job)
    this.deps.onChange?.(structuredClone(job))
  }

  #checkpoint(job: ProcessingJob, key: string): Checkpoint {
    return {
      get: () => job.checkpoints[key],
      set: async (value) => {
        job.checkpoints[key] = value
        await this.#save(job)
      },
    }
  }

  #progress(job: ProcessingJob, from: number, to: number) {
    return (p: number) => {
      job.progress = from + (to - from) * Math.min(1, Math.max(0, p))
      void this.#save(job).catch(() => {})
    }
  }

  async #step(job: ProcessingJob, step: StepId) {
    // 已被停止就不再开始下一步
    this.#current?.controller.signal.throwIfAborted()
    job.step = step
    job.progress = undefined
    await this.#save(job)
  }

  async #run(job: ProcessingJob): Promise<void> {
    const controller = new AbortController()
    this.#current = { meetingId: job.meetingId, controller }
    job.state = 'running'
    job.attempts += 1
    job.nextAttemptAt = undefined
    await this.#save(job)
    try {
      await this.#process(job, controller.signal)
    } catch (e) {
      await this.#fail(job, e, controller.signal)
    } finally {
      this.#current = undefined
    }
  }

  async #process(job: ProcessingJob, signal: AbortSignal): Promise<void> {
    const id = job.meetingId
    const meeting = await this.deps.source.readMeeting(id)
    if (!meeting) throw new PipelineError('meetingNotFound')
    if (!meeting.media?.audio) throw new PipelineError('noAudio')

    // 1. 转写
    let transcript = await readJson(this.deps.work, WORK.transcript(id), (v) => Transcript.parse(v))
    if (!transcript) {
      await this.#step(job, 'transcribe')
      transcript = await this.#transcribe(job, meeting, signal)
      await this.deps.work.writeFile(WORK.transcript(id), toJson(transcript))
    }
    const locale = summaryLocale(meeting.language, transcript)
    const speakers = speakersFromTranscript(transcript, locale)

    // 2. 纪要（大模型未配置时跳过，只保存逐字稿；配置后可再次处理补上纪要）
    let summary = await readJson(this.deps.work, WORK.summary(id), (v) => Summary.parse(v))
    if (summary) {
      job.summary = { state: 'done' }
    } else {
      await this.#step(job, 'summarize')
      const result = await this.#summarize(job, meeting, transcript, speakers, locale, signal)
      if ('skipped' in result) {
        job.summary = { state: 'skipped', reason: result.skipped }
      } else {
        summary = result.summary
        await this.deps.work.writeFile(WORK.summary(id), toJson(summary))
        job.summary = { state: 'done' }
      }
    }

    // 3. 写入数据文件夹
    await this.#step(job, 'write')
    if (!(await this.deps.folder.isReady())) throw new FolderNotReadyError('prompt')
    const done: Meeting = {
      ...meeting,
      status: 'ready',
      speakers: meeting.speakers.length > 0 ? meeting.speakers : speakers,
      providers: {
        ...meeting.providers,
        ...(job.transcriptionProviderId ? { transcription: job.transcriptionProviderId } : {}),
        ...(job.summary.state === 'done' && job.llmProviderId ? { llm: job.llmProviderId } : {}),
      },
    }
    await this.#write(job, done, transcript, summary, locale)
    await this.deps.source.writeMeeting(id, done)

    job.state = 'done'
    job.error = undefined
    job.progress = undefined
    job.finishedAt = this.#now()
    await this.#save(job)
  }

  async #transcribe(
    job: ProcessingJob,
    meeting: Meeting,
    signal: AbortSignal,
  ): Promise<Transcript> {
    const service = (await this.deps.services()).transcription
    if (!service.ok) {
      throw new PipelineError(
        service.issue === 'notConfigured'
          ? 'transcriptionNotConfigured'
          : service.issue === 'unknownProvider'
            ? 'unknownProvider'
            : 'hostPermission',
      )
    }
    const { provider, config } = service
    job.transcriptionProviderId = provider.id
    const audio = await this.deps.source.readAudio(meeting.id)
    if (!audio) throw new PipelineError('noAudio')
    const input = {
      mimeType: audio.mimeType,
      durationMs: meeting.durationMs,
      language: meeting.language,
    }
    const max = provider.capabilities.maxFileBytes
    if (!max || audio.blob.size <= max) {
      return provider.transcribe({ ...input, blob: audio.blob }, config, {
        signal,
        onProgress: this.#progress(job, 0, 1),
        checkpoint: this.#checkpoint(job, `transcribe:${provider.id}`),
      })
    }

    // 超过单文件上限：按静音点切片，逐片转写后按偏移合并时间轴
    const splitter = this.deps.splitter
    if (!splitter) throw new PipelineError('splitFailed', false, 'no splitter')
    const splitKey = `split:${Math.floor(max * SPLIT_MARGIN)}`
    let cuts = job.checkpoints[splitKey] as number[] | undefined
    if (!Array.isArray(cuts) || cuts.length < 2) {
      try {
        cuts = await splitter.plan(audio.blob, Math.floor(max * SPLIT_MARGIN))
      } catch (e) {
        throw new PipelineError('splitFailed', false, e instanceof Error ? e.message : String(e))
      }
      await this.#checkpoint(job, splitKey).set(cuts)
    }
    const count = cuts.length - 1
    const pieces: { transcript: Transcript; offsetMs: number }[] = []
    for (let i = 0; i < count; i++) {
      const offsetMs = Math.round(cuts[i]! * 1000)
      const path = WORK.piece(meeting.id, i)
      const cached = await readJson(this.deps.work, path, (v) => {
        const p = v as { providerId?: unknown; transcript?: unknown }
        if (p.providerId !== provider.id) throw new Error('other provider')
        return Transcript.parse(p.transcript)
      })
      if (cached) {
        pieces.push({ transcript: cached, offsetMs })
        continue
      }
      let piece: { blob: Blob; mimeType: string }
      try {
        piece = await splitter.cut(audio.blob, cuts[i]!, cuts[i + 1]!)
      } catch (e) {
        throw new PipelineError('splitFailed', false, e instanceof Error ? e.message : String(e))
      }
      const transcript = await provider.transcribe(
        {
          ...input,
          ...piece,
          durationMs: Math.round((cuts[i + 1]! - cuts[i]!) * 1000),
        },
        config,
        {
          signal,
          onProgress: this.#progress(job, i / count, (i + 1) / count),
          checkpoint: this.#checkpoint(job, `transcribe:${provider.id}:${i}`),
        },
      )
      await this.deps.work.writeFile(path, toJson({ providerId: provider.id, transcript }))
      pieces.push({ transcript, offsetMs })
    }
    return mergeTranscripts(pieces, meeting.language)
  }

  async #summarize(
    job: ProcessingJob,
    meeting: Meeting,
    transcript: Transcript,
    speakers: ReturnType<typeof speakersFromTranscript>,
    locale: string,
    signal: AbortSignal,
  ): Promise<{ summary: Summary } | { skipped: SummarySkipReason }> {
    // 没有识别出任何内容（例如全程静音）：不让大模型凭空生成
    if (transcript.segments.length === 0) return { skipped: 'emptyTranscript' }
    const service = (await this.deps.services()).llm
    if (!service.ok) return { skipped: service.issue }
    const { provider, config } = service
    job.llmProviderId = provider.id
    const template = generalSummaryTemplate
    const raw = await provider.generateObject(
      {
        system: template.systemPrompt(locale),
        prompt: buildSummaryPrompt(meeting, transcript, speakers, locale),
        schema: template.outputSchema,
      },
      config,
      { signal, onProgress: this.#progress(job, 0, 1) },
    )
    return { summary: normalizeSummary(raw, speakers, meeting.durationMs) }
  }

  /** Verify ownership on every write, including after the user changes folders. */
  async #folderDir(job: ProcessingJob, meeting: Meeting, mediaNames: string[]): Promise<string> {
    const base = meetingFolderName(meeting)
    const candidates = [
      ...(job.folderDir ? [job.folderDir] : []),
      ...Array.from({ length: 99 }, (_, i) => (i === 0 ? base : `${base} (${i + 1})`)),
    ]
    for (const dir of new Set(candidates)) {
      const metadata = await this.deps.folder.readFile(`${dir}/meeting.json`)
      const reservation = await this.deps.folder.readFile(`${dir}/.huilu-owner.json`)
      const ownedByMeeting = async (blob: Blob) => {
        try {
          return (JSON.parse(await blob.text()) as { id?: unknown }).id === meeting.id
        } catch {
          return false
        }
      }
      if (metadata && !(await ownedByMeeting(metadata))) continue
      if (reservation && !(await ownedByMeeting(reservation))) continue
      if (!metadata && !reservation) {
        // A partial directory without an ownership record is not safe to reuse.
        const names = [...mediaNames, 'transcript.json', 'summary.json', 'summary.md']
        const files = await Promise.all(
          names.map((name) => this.deps.folder.readFile(`${dir}/${name}`)),
        )
        if (files.some(Boolean)) continue
      }
      // Reserve before writing artifacts: another job must not adopt this
      // directory if writing fails before the final meeting.json commit.
      if (!reservation) {
        await this.deps.folder.writeFile(`${dir}/.huilu-owner.json`, toJson({ id: meeting.id }))
      }
      job.folderDir = dir
      await this.#save(job)
      return dir
    }
    throw new PipelineError('writeFailed', false, `no free folder name for ${base}`)
  }

  /**
   * 写入顺序：音视频 → 逐字稿 → 纪要 → meeting.json（最后写，有它才算一场完整的会议）。
   * 可重复执行：大小相同的音视频不再重写；已存在的 transcript / summary 文件不覆盖
   * （数据文件夹是唯一的真实数据，用户以后在结果页的修改不能被重新处理冲掉）
   */
  async #write(
    job: ProcessingJob,
    meeting: Meeting,
    transcript: Transcript,
    summary: Summary | undefined,
    locale: string,
  ): Promise<void> {
    const folder = this.deps.folder
    const media = await this.deps.source.readMedia(meeting.id)
    const dir = await this.#folderDir(
      job,
      meeting,
      media.map((m) => m.name),
    )
    const total = media.reduce((sum, m) => sum + m.blob.size, 0) || 1
    let written = 0
    for (const { name, blob } of media) {
      const existing = await folder.readFile(`${dir}/${name}`)
      if (existing?.size !== blob.size) await folder.writeFile(`${dir}/${name}`, blob)
      written += blob.size
      this.#progress(job, 0, 0.9)(written / total)
    }
    const writeIfMissing = async (name: string, content: () => string) => {
      if (!(await folder.readFile(`${dir}/${name}`))) {
        await folder.writeFile(`${dir}/${name}`, content())
      }
    }
    await writeIfMissing('transcript.json', () => toJson(transcript))
    if (summary) {
      await writeIfMissing('summary.json', () => toJson(summary))
      await writeIfMissing('summary.md', () =>
        renderSummaryMarkdown(meeting, summary, meeting.speakers, locale),
      )
    }
    // meeting.json：已存在（同一场会议）时保留用户改过的标题、发言人名、打点，只更新状态与服务商
    const existing = await readJson(folder, `${dir}/meeting.json`, (v) => Meeting.parse(v))
    const merged: Meeting = existing
      ? {
          ...existing,
          status: meeting.status,
          media: meeting.media,
          providers: { ...existing.providers, ...meeting.providers },
          speakers: existing.speakers.length > 0 ? existing.speakers : meeting.speakers,
        }
      : meeting
    await folder.writeFile(`${dir}/meeting.json`, toJson(Meeting.parse(merged)))
    job.progress = 1
  }

  async #fail(job: ProcessingJob, e: unknown, signal: AbortSignal): Promise<void> {
    const step = job.step ?? 'transcribe'
    // 离屏文档关闭 / 主动停止：回到队列，下次启动继续，不算一次失败
    if (signal.aborted) {
      job.state = 'queued'
      job.attempts = Math.max(0, job.attempts - 1)
      await this.#save(job)
      return
    }
    // 写入途中授权被收回：浏览器抛 NotAllowedError，同样等待重新授权
    const permissionLost =
      step === 'write' &&
      e instanceof DOMException &&
      (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    if (e instanceof FolderNotReadyError || permissionLost) {
      job.state = 'waitingFolder'
      job.error = undefined
      job.progress = undefined
      await this.#save(job)
      return
    }
    let error: JobError
    let retryAfterMs: number | undefined
    if (e instanceof ProviderError) {
      error = { step, code: e.code, detail: e.detail, retryable: isRetryable(e.code) }
      retryAfterMs = e.retryAfterMs
    } else if (e instanceof PipelineError) {
      error = {
        step,
        code: e.code,
        detail: e.message === e.code ? undefined : e.message,
        retryable: e.retryable,
      }
    } else {
      // 写入校验失败、OPFS 读写异常等：可能是暂时的，按可重试处理
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      error = {
        step,
        code: e instanceof WriteVerificationError || step === 'write' ? 'writeFailed' : 'unknown',
        detail: detail.slice(0, 500),
        retryable: true,
      }
    }
    job.error = error
    job.progress = undefined
    if (error.retryable && job.attempts < MAX_AUTO_ATTEMPTS) {
      job.state = 'queued'
      job.nextAttemptAt = this.#now() + retryDelayMs(job.attempts, retryAfterMs)
    } else {
      job.state = 'failed'
      job.error = { ...error, retryable: false }
      job.finishedAt = this.#now()
      const meeting = await this.deps.source.readMeeting(job.meetingId).catch(() => undefined)
      if (meeting && meeting.status === 'processing') {
        await this.deps.source
          .writeMeeting(job.meetingId, { ...meeting, status: 'failed' })
          .catch(() => {})
      }
    }
    await this.#save(job)
  }
}
