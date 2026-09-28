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
import {
  ProviderError,
  describeErrorBody,
  isQuotaExceededDetail,
  isRetryable,
  redactSecrets,
} from '@huilu/providers'
import { FolderNotReadyError, WriteVerificationError } from '@huilu/storage'
import { fingerprint } from './fingerprint'
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
  folder: Files & Pick<StorageAdapter, 'isReady' | 'isDirectoryEmpty'>
  services(): Promise<ResolvedServices>
  splitter?: AudioSplitter
  now?: () => number
  /** 启动恢复（读取任务 / 检查文件夹权限）失败后多久自动重试，默认 5 秒 */
  startRetryMs?: number
  /** 队列读写任务存储（IndexedDB）失败后重新执行的起始间隔，按次数翻倍，上限 1 分钟；默认 1 秒 */
  storageRetryMs?: number
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

/** 旧版本持久化为 rateLimited、实际是结构化余额 / 欠费错误码的任务（排队重试中或已失败） */
function isLegacyQuotaError(job: ProcessingJob): boolean {
  return (
    (job.state === 'queued' || job.state === 'failed') &&
    job.error?.code === 'rateLimited' &&
    isQuotaExceededDetail(job.error.detail)
  )
}

/** 旧版本保存的原始响应 JSON → 「码: 说明」，并去掉可能的凭据 */
function readableDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined
  const { code, message } = describeErrorBody(detail.trim())
  return redactSecrets(code && message ? `${code}: ${message}` : detail).slice(0, 300)
}

/** 路径上某一段的类型不对：期望目录却是文件，或反过来 */
const isTypeMismatch = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TypeMismatchError'
const OCCUPIED = Symbol('occupied')

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
  /** 启动恢复成功完成后才为 true；失败时保持 false，下次 start() / 定时重试会重新恢复 */
  #reconciled = false
  #starting?: Promise<void>
  #retryTimer?: ReturnType<typeof setTimeout>
  #stopped = false
  /** 连续几轮执行循环因任务存储读写失败而中断，用于退避 */
  #storageFailures = 0
  /** 执行中途因存储失败中断、可能仍被持久化为 running 的任务：下一轮先改回 queued */
  #stranded = new Set<string>()

  constructor(private readonly deps: ProcessingDeps) {}

  #now() {
    return (this.deps.now ?? Date.now)()
  }

  /**
   * 离屏文档启动时调用：上次没跑完（running）的任务改回 queued 并继续。
   * 恢复失败（读取任务 / 检查文件夹权限出错）时抛出并定时重试，再次调用 start() 也会重试；
   * 已恢复后再调用只触发队列。并发调用共用同一次恢复，不会重复退还尝试次数
   */
  start(): Promise<void> {
    this.#stopped = false
    if (this.#reconciled) {
      this.kick()
      return Promise.resolve()
    }
    this.#starting ??= this.#reconcile()
      .finally(() => (this.#starting = undefined))
      .then(() => this.kick())
    return this.#starting
  }

  async #reconcile(): Promise<void> {
    clearTimeout(this.#retryTimer)
    try {
      for (const listed of await this.deps.jobs.list()) {
        // 部分恢复后重试：已改回 queued 的不会再退还；本进程正在执行的不是中断遗留
        if (listed.meetingId === this.#current?.meetingId) continue
        const job = await this.deps.jobs.get(listed.meetingId)
        if (job?.state === 'running') {
          await this.#save({ ...job, state: 'queued', attempts: Math.max(0, job.attempts - 1) })
        } else if (job?.state === 'waitingFolder' && (await this.deps.folder.isReady())) {
          await this.#save({ ...job, state: 'queued', nextAttemptAt: undefined })
        } else if (job && isLegacyQuotaError(job)) {
          // 旧版本把余额不足 / 欠费（如智谱 1113）当作限流排了自动重试：改为需要用户处理的失败，
          // 取消重试计划；逐字稿等中间结果保留，处理好账户后手动重试从出错的步骤继续
          await this.#markFailed(job, {
            ...job.error!,
            code: 'quotaExceeded',
            detail: readableDetail(job.error!.detail),
          })
        }
      }
    } catch (e) {
      if (!this.#stopped) {
        this.#retryTimer = setTimeout(() => {
          this.start().catch((err: unknown) => {
            console.warn('[huilu] processing queue recovery failed again', err)
          })
        }, this.deps.startRetryMs ?? 5000)
      }
      throw e
    }
    this.#reconciled = true
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
      folderCommitted: existing?.folderCommitted || existing?.state === 'done',
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
    try {
      if (meeting.status !== 'processing') {
        await this.deps.source.writeMeeting(meetingId, { ...meeting, status: 'processing' })
      }
    } finally {
      this.kick()
    }
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
    clearTimeout(this.#retryTimer)
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
        await this.#requeueStranded()
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
          // 启动恢复进行中：不开始新任务，恢复完成后会再次触发队列
          if (this.#starting) break
          await this.#run(due)
        }
      } while (this.#kickAgain)
      this.#storageFailures = 0
    } catch (e) {
      // 任务存储（IndexedDB）读写失败：没有新的定时器或 kick 时队列会一直停住，
      // 按次数退避后重新执行（有上限，不会忙循环）
      this.#storageFailures++
      console.error('[huilu] processing queue failed', e)
      if (!this.#stopped) {
        const delay = Math.min(
          60_000,
          (this.deps.storageRetryMs ?? 1000) * 2 ** (this.#storageFailures - 1),
        )
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => this.kick(), delay)
      }
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
    try {
      // 标记 running 失败时任务仍是 queued；记录失败 / 完成时写入失败则可能停在 running
      await this.#save(job)
      try {
        await this.#process(job, controller.signal)
      } catch (e) {
        await this.#fail(job, e, controller.signal)
      }
    } catch (e) {
      this.#stranded.add(job.meetingId)
      throw e
    } finally {
      this.#current = undefined
    }
  }

  /** 上一轮因存储失败中断的任务：仍是 running 的改回 queued（本进程没有在执行它），重新排队 */
  async #requeueStranded(): Promise<void> {
    for (const meetingId of this.#stranded) {
      const job = await this.deps.jobs.get(meetingId)
      if (job?.state === 'running') {
        await this.#save({ ...job, state: 'queued', nextAttemptAt: undefined, progress: undefined })
      }
      this.#stranded.delete(meetingId)
    }
  }

  async #process(job: ProcessingJob, signal: AbortSignal): Promise<void> {
    const id = job.meetingId
    let meeting = await this.deps.source.readMeeting(id)
    if (!meeting) throw new PipelineError('meetingNotFound')
    if (!meeting.media?.audio) throw new PipelineError('noAudio')

    // 完成目录中的用户修改是权威来源；不能悄悄回退到旧 OPFS。
    let authoritative: { meeting: Meeting; transcript: Transcript } | undefined
    if (job.folderCommitted) {
      await this.#step(job, 'summarize')
      authoritative = await this.#authoritative(job)
      meeting = authoritative.meeting
    }

    // 1. 转写
    let transcript =
      authoritative?.transcript ??
      (await readJson(this.deps.work, WORK.transcript(id), (v) => Transcript.parse(v)))
    if (!transcript) {
      await this.#step(job, 'transcribe')
      transcript = await this.#transcribe(job, meeting, signal)
      await this.deps.work.writeFile(WORK.transcript(id), toJson(transcript))
    }
    const locale = summaryLocale(meeting.language, transcript)
    const speakers = speakersFromTranscript(transcript, locale).map(
      (speaker) => meeting.speakers.find((s) => s.id === speaker.id) ?? speaker,
    )
    const summaryInput = await fingerprint({
      prompt: buildSummaryPrompt(meeting, transcript, speakers, locale),
      locale,
    })

    // 2. 纪要（大模型未配置时跳过，只保存逐字稿；配置后可再次处理补上纪要）
    let summary = await readJson(this.deps.work, WORK.summary(id), (v) => Summary.parse(v))
    if (authoritative) {
      // 已提交的纪要保留；失败补写留下的 OPFS 纪要仅在输入未变时复用。
      const saved = meeting.providers?.llm
        ? await readJson(this.deps.folder, `${job.folderDir}/summary.json`, (v) => Summary.parse(v))
        : undefined
      summary = saved ?? (job.checkpoints.summaryInput === summaryInput ? summary : undefined)
    }
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
        job.checkpoints.summaryInput = summaryInput
        await this.#save(job)
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
    if (authoritative) {
      const current = await this.#authoritative(job)
      if ((await fingerprint(current)) !== (await fingerprint(authoritative))) {
        throw new PipelineError('sourceDataUnavailable')
      }
    }
    await this.#write(job, done, transcript, summary, locale)
    await this.deps.source.writeMeeting(id, done)

    job.folderCommitted = true
    job.state = 'done'
    job.error = undefined
    job.progress = undefined
    job.finishedAt = this.#now()
    await this.#save(job)
  }

  async #authoritative(job: ProcessingJob): Promise<{ meeting: Meeting; transcript: Transcript }> {
    const folder = this.deps.folder
    if (!(await folder.isReady())) throw new FolderNotReadyError('prompt')
    if (!job.folderDir) throw new PipelineError('sourceDataUnavailable')
    const meeting = await readJson(folder, `${job.folderDir}/meeting.json`, (v) => Meeting.parse(v))
    const transcript = await readJson(folder, `${job.folderDir}/transcript.json`, (v) => {
      const parsed = Transcript.parse(v)
      if (
        parsed.segments.some(
          (s, i, all) => s.endMs < s.startMs || (i > 0 && s.startMs < all[i - 1]!.startMs),
        )
      ) {
        throw new Error('invalid transcript timeline')
      }
      return parsed
    })
    const owner = await folder.readFile(`${job.folderDir}/.huilu-owner.json`)
    let owned = true
    if (owner) {
      try {
        owned = JSON.parse(await owner.text()).id === job.meetingId
      } catch {
        owned = false
      }
    }
    if (
      !owned ||
      !meeting ||
      meeting.id !== job.meetingId ||
      meeting.status !== 'ready' ||
      !transcript
    ) {
      throw new PipelineError('sourceDataUnavailable')
    }
    return { meeting, transcript }
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
    const binding = await fingerprint({
      version: 1,
      provider: provider.id,
      config,
      input,
      size: audio.blob.size,
      max,
    })
    if (job.checkpoints.transcriptionBinding !== binding) {
      // Legacy unbound checkpoints cannot prove configuration identity either.
      for (const key of Object.keys(job.checkpoints)) {
        if (key.startsWith('transcribe:') || key.startsWith('split:')) delete job.checkpoints[key]
      }
      job.checkpoints.transcriptionBinding = binding
      await this.#save(job)
    }
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
    const validCuts = (value: unknown): value is number[] =>
      Array.isArray(value) &&
      value.length >= 2 &&
      value[0] === 0 &&
      value.every((cut, i) => Number.isFinite(cut) && (i === 0 || cut > value[i - 1]))
    if (!validCuts(cuts)) {
      try {
        cuts = await splitter.plan(audio.blob, Math.floor(max * SPLIT_MARGIN))
      } catch (e) {
        throw new PipelineError('splitFailed', false, e instanceof Error ? e.message : String(e))
      }
      if (!validCuts(cuts)) throw new PipelineError('splitFailed', false, 'invalid split plan')
      await this.#checkpoint(job, splitKey).set(cuts)
    }
    const pieceBinding = await fingerprint({ binding, cuts })
    const count = cuts.length - 1
    const pieces: { transcript: Transcript; offsetMs: number }[] = []
    for (let i = 0; i < count; i++) {
      const offsetMs = Math.round(cuts[i]! * 1000)
      const path = WORK.piece(meeting.id, i)
      const cached = await readJson(this.deps.work, path, (v) => {
        const p = v as { binding?: unknown; transcript?: unknown }
        if (p.binding !== pieceBinding) throw new Error('different transcription input')
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
          checkpoint: this.#checkpoint(job, `transcribe:${provider.id}:${pieceBinding}:${i}`),
        },
      )
      await this.deps.work.writeFile(
        path,
        toJson({ binding: pieceBinding, transcript: Transcript.parse(transcript) }),
      )
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
  async #folderDir(job: ProcessingJob, meeting: Meeting): Promise<string> {
    const base = meetingFolderName(meeting)
    const candidates = [
      ...(job.folderDir ? [job.folderDir] : []),
      ...Array.from({ length: 99 }, (_, i) => (i === 0 ? base : `${base} (${i + 1})`)),
    ]
    // 候选名已被普通文件占用（或 meeting.json 是目录）时读取会抛 TypeMismatchError：
    // 视为别人的内容，换下一个后缀；权限 / IO 等其他错误照常抛出
    const probe = async (path: string): Promise<Blob | undefined | typeof OCCUPIED> => {
      try {
        return await this.deps.folder.readFile(path)
      } catch (e) {
        if (isTypeMismatch(e)) return OCCUPIED
        throw e
      }
    }
    for (const dir of new Set(candidates)) {
      const metadata = await probe(`${dir}/meeting.json`)
      if (metadata === OCCUPIED) continue
      const reservation = await probe(`${dir}/.huilu-owner.json`)
      if (reservation === OCCUPIED) continue
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
        // 必须枚举目录：任意文件名、其他媒体后缀和空子目录都属于已有内容。
        if (!(await this.deps.folder.isDirectoryEmpty(dir))) continue
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
   * 可重复执行：大小相同的音视频不再重写；合法 JSON 与已提交的 Markdown 编辑保留
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
    const dir = await this.#folderDir(job, meeting)
    const existing = await readJson(folder, `${dir}/meeting.json`, (v) => Meeting.parse(v))
    const ownerPath = `${dir}/.huilu-owner.json`
    const owner = (await readJson(folder, ownerPath, (v) => v)) as {
      id: string
      pending?: string
      markdownComplete?: boolean
    }
    const writeVerified = async (name: string, content: string) => {
      // 先持久化意图，避免已完成会议补纪要失败后把半截 Markdown 当成用户编辑。
      owner.pending = name
      await folder.writeFile(ownerPath, toJson(owner))
      await folder.writeFile(`${dir}/${name}`, content)
      if ((await (await folder.readFile(`${dir}/${name}`))?.text()) !== content) {
        throw new PipelineError('writeFailed', true, `incomplete ${name}`)
      }
      delete owner.pending
      if (name === 'summary.md') owner.markdownComplete = true
      await folder.writeFile(ownerPath, toJson(owner))
    }
    const total = media.reduce((sum, m) => sum + m.blob.size, 0) || 1
    let written = 0
    for (const { name, blob } of media) {
      const existing = await folder.readFile(`${dir}/${name}`)
      if (existing?.size !== blob.size) await folder.writeFile(`${dir}/${name}`, blob)
      written += blob.size
      this.#progress(job, 0, 0.9)(written / total)
    }
    if (
      owner.pending === 'transcript.json' ||
      !(await readJson(folder, `${dir}/transcript.json`, (v) => Transcript.parse(v)))
    ) {
      await writeVerified('transcript.json', toJson(transcript))
    }
    if (summary) {
      const saved =
        owner.pending === 'summary.json' || (job.folderCommitted && !existing?.providers?.llm)
          ? undefined
          : await readJson(folder, `${dir}/summary.json`, (v) => Summary.parse(v))
      if (!saved) await writeVerified('summary.json', toJson(summary))
      const markdown = await (await folder.readFile(`${dir}/summary.md`))?.text()
      const committed =
        !(job.folderCommitted && !existing?.providers?.llm) &&
        (owner.markdownComplete || (existing?.status === 'ready' && existing.providers?.llm))
      if (owner.pending === 'summary.md' || !markdown?.trim() || !committed) {
        await writeVerified(
          'summary.md',
          renderSummaryMarkdown(meeting, saved ?? summary, meeting.speakers, locale),
        )
      }
    }
    // 最后提交元数据；保留同一场会议合法的标题、发言人名和打点编辑。
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
      (step === 'write' || job.folderCommitted) &&
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
      await this.#save(job)
    } else {
      await this.#markFailed(job, error)
    }
  }

  /** 停在 failed 等用户处理：不再自动重试，会议标记为失败 */
  async #markFailed(job: ProcessingJob, error: JobError): Promise<void> {
    job.state = 'failed'
    job.error = { ...error, retryable: false }
    job.progress = undefined
    job.nextAttemptAt = undefined
    job.finishedAt = this.#now()
    const meeting = await this.deps.source.readMeeting(job.meetingId).catch(() => undefined)
    if (meeting && meeting.status === 'processing') {
      await this.deps.source
        .writeMeeting(job.meetingId, { ...meeting, status: 'failed' })
        .catch(() => {})
    }
    await this.#save(job)
  }
}
