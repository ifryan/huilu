import {
  MEETING_SCHEMA_VERSION,
  Meeting,
  Summary,
  Transcript,
  type LlmProvider,
  type TranscriptionProvider,
} from '@huilu/core'
import { ProviderError } from '@huilu/providers'
import { FolderNotReadyError } from '@huilu/storage'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { fingerprint } from './fingerprint'
import { MemoryJobStore } from './jobs'
import {
  MAX_AUTO_ATTEMPTS,
  ProcessingQueue,
  type MeetingSource,
  type ResolvedServices,
} from './processor'
import type { AudioSplitter } from './split'

const MEETING_ID = '20260928-103000-abcd1234'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return Meeting.parse({
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: MEETING_ID,
    title: '需求评审',
    createdAt: new Date(2026, 8, 28, 10, 30).toISOString(),
    durationMs: 45_000,
    mode: 'video',
    videoSource: 'tab',
    language: 'zh',
    status: 'processing',
    media: {
      video: { mimeType: 'video/mp4;codecs=avc1,opus' },
      audio: { mimeType: 'audio/webm;codecs=opus' },
    },
    ...overrides,
  })
}

const transcript: Transcript = {
  language: 'zh',
  segments: [
    { startMs: 760, endMs: 3240, speakerId: '0', text: '我们开始今天的需求评审。' },
    { startMs: 3900, endMs: 6120, speakerId: '1', text: '好的，先看登录页。' },
  ],
}

const summary: Summary = {
  keywords: ['需求评审', ' ', '需求评审'],
  overview: '评审登录页',
  chapters: [
    { startMs: 99_000, title: '收尾', summary: '超出时长' },
    { startMs: 760, title: '开场', summary: '宣布开始' },
  ],
  speakerSummaries: [
    { speakerId: '0', summary: '主持' },
    { speakerId: '9', summary: '不存在的发言人' },
  ],
  keyPoints: ['先看登录页'],
  actionItems: [{ text: '出设计稿', owner: '小王', due: '周三' }],
}

/** 内存文件：模拟 OPFS / 数据文件夹 */
class Files {
  readonly files = new Map<string, Blob>()
  ready = true
  writes: string[] = []
  directories = new Set<string>()
  async isDirectoryEmpty(path: string) {
    return ![...this.files.keys(), ...this.directories].some((p) => p.startsWith(`${path}/`))
  }
  async isReady() {
    return this.ready
  }
  async readFile(path: string) {
    if (!this.ready) throw new FolderNotReadyError('prompt')
    return this.files.get(path)
  }
  async writeFile(path: string, data: Blob | string) {
    if (!this.ready) throw new FolderNotReadyError('prompt')
    this.writes.push(path)
    this.files.set(path, typeof data === 'string' ? new Blob([data]) : data)
  }
  async text(path: string) {
    return this.files.get(path)?.text()
  }
  async json(path: string) {
    const text = await this.text(path)
    return text === undefined ? undefined : JSON.parse(text)
  }
}

function setup(
  options: {
    meeting?: Meeting
    audio?: Blob | null
    transcribe?: TranscriptionProvider['transcribe']
    maxFileBytes?: number
    generate?: (request: { system: string; prompt: string }) => Promise<unknown>
    services?: Partial<ResolvedServices>
    splitter?: AudioSplitter
  } = {},
) {
  let stored: Meeting | undefined = options.meeting ?? meeting()
  const audio = options.audio === undefined ? new Blob([new Uint8Array(200)]) : options.audio
  const source: MeetingSource & { meeting: () => Meeting | undefined } = {
    meeting: () => stored,
    readMeeting: async () => stored && structuredClone(stored),
    writeMeeting: async (_id, m) => void (stored = Meeting.parse(m)),
    readAudio: async () =>
      audio ? { blob: audio, mimeType: 'audio/webm;codecs=opus' } : undefined,
    readMedia: async () => [
      { name: 'video.mp4', blob: new Blob([new Uint8Array(500)]) },
      ...(audio ? [{ name: 'audio.webm', blob: audio }] : []),
    ],
  }
  const transcription: TranscriptionProvider = {
    id: 'fake-asr',
    nameKey: 'fake',
    configSchema: z.unknown(),
    capabilities: { diarization: true, languages: ['zh'], maxFileBytes: options.maxFileBytes },
    testConnection: async () => {},
    transcribe: vi.fn(options.transcribe ?? (async () => structuredClone(transcript))),
  }
  const llm: LlmProvider = {
    id: 'fake-llm',
    nameKey: 'fake',
    configSchema: z.unknown(),
    testConnection: async () => {},
    generateObject: vi.fn(async (request, _config, _ctx) =>
      request.schema.parse(await (options.generate ?? (async () => summary))(request)),
    ) as LlmProvider['generateObject'],
  }
  const services: ResolvedServices = {
    transcription: { ok: true, provider: transcription, config: { key: 'x' } },
    llm: { ok: true, provider: llm, config: {} },
    ...options.services,
  }
  const jobs = new MemoryJobStore()
  const work = new Files()
  const folder = new Files()
  let now = 1_000_000
  let idle: () => void = () => {}
  const deps = {
    jobs,
    source,
    work,
    folder,
    services: async () => services,
    splitter: options.splitter,
    now: () => now,
    startRetryMs: undefined as number | undefined,
    storageRetryMs: 5 as number | undefined,
    onIdle: () => idle(),
  }
  const queue = new ProcessingQueue(deps)
  /** 等队列停下来（完成，或者停在等待重试 / 等待授权 / 失败）：没有 running 的任务并且连续几轮保持不变 */
  const settle = async () => {
    let quiet = 0
    for (let i = 0; i < 500 && quiet < 5; i++) {
      await new Promise((r) => setTimeout(r, 1))
      const running = (await jobs.list()).some((j) => j.state === 'running')
      quiet = running ? 0 : quiet + 1
    }
  }
  return {
    queue,
    jobs,
    work,
    folder,
    source,
    services,
    transcription,
    llm,
    deps,
    advance: (ms: number) => (now += ms),
    onIdle: () => new Promise<void>((resolve) => (idle = resolve)),
    settle,
    job: () => jobs.get(MEETING_ID),
  }
}

const DIR = '2026-09-28_1030_需求评审'

describe('ProcessingQueue', () => {
  it('transcribes, summarizes and writes everything into the data folder', async () => {
    const t = setup()
    const idle = t.onIdle()
    expect(await t.queue.enqueue(MEETING_ID, { auto: true })).toMatchObject({ queued: true })
    await idle

    const job = await t.job()
    expect(job).toMatchObject({
      state: 'done',
      step: 'write',
      attempts: 1,
      folderDir: DIR,
      summary: { state: 'done' },
      transcriptionProviderId: 'fake-asr',
      llmProviderId: 'fake-llm',
    })
    expect(t.folder.writes.filter((p) => !p.endsWith('/.huilu-owner.json'))).toEqual([
      `${DIR}/video.mp4`,
      `${DIR}/audio.webm`,
      `${DIR}/transcript.json`,
      `${DIR}/summary.json`,
      `${DIR}/summary.md`,
      `${DIR}/meeting.json`,
    ])
    expect(await t.folder.json(`${DIR}/transcript.json`)).toEqual(transcript)
    const written = Summary.parse(await t.folder.json(`${DIR}/summary.json`))
    // 章节按时间排序并限制在会议时长内，未知发言人、空关键词被去掉
    expect(written.chapters.map((c) => c.startMs)).toEqual([760, 45_000])
    expect(written.speakerSummaries).toEqual([{ speakerId: '0', summary: '主持' }])
    expect(written.keywords).toEqual(['需求评审'])
    const md = await t.folder.text(`${DIR}/summary.md`)
    expect(md).toContain('# 需求评审')
    expect(md).toContain('## 待办事项')
    expect(md).toContain('- [ ] 出设计稿（负责人: 小王，截止: 周三）')
    expect(md).toContain('**发言人 1**: 主持')

    const folderMeeting = Meeting.parse(await t.folder.json(`${DIR}/meeting.json`))
    expect(folderMeeting).toMatchObject({
      id: MEETING_ID,
      status: 'ready',
      speakers: [
        { id: '0', name: '发言人 1' },
        { id: '1', name: '发言人 2' },
      ],
      providers: { transcription: 'fake-asr', llm: 'fake-llm' },
    })
    // API Key 等配置不写进数据文件夹
    for (const [, blob] of t.folder.files) expect(await blob.text()).not.toContain('"key"')
    expect(t.source.meeting()?.status).toBe('ready')

    // 大模型拿到带毫秒时间戳和发言人说明的逐字稿
    const request = vi.mocked(t.llm.generateObject).mock.calls[0]![0]
    expect(request.prompt).toContain('[00:00 | 760] 发言人 1: 我们开始今天的需求评审。')
    expect(request.prompt).toContain('发言人 2: speakerId = "1"')
    expect(request.system).toContain('简体中文')
  })

  it('never queues recordings without transcription audio', async () => {
    for (const t of [
      setup({
        meeting: meeting({ status: 'failed', media: { video: { mimeType: 'video/mp4' } } }),
      }),
      setup({ audio: null }),
    ]) {
      expect(await t.queue.enqueue(MEETING_ID)).toEqual({ queued: false, reason: 'noAudio' })
      expect(await t.queue.enqueue(MEETING_ID, { auto: true })).toEqual({
        queued: false,
        reason: 'noAudio',
      })
      expect(await t.jobs.list()).toEqual([])
      expect(t.transcription.transcribe).not.toHaveBeenCalled()
    }
  })

  it('only auto-queues when a transcription service is configured', async () => {
    const t = setup({ services: { transcription: { ok: false, issue: 'notConfigured' } } })
    expect(await t.queue.enqueue(MEETING_ID, { auto: true })).toEqual({
      queued: false,
      reason: 'notConfigured',
    })
    expect(await t.jobs.list()).toEqual([])
    expect(t.source.meeting()?.status).toBe('processing')

    // 用户在历史记录里点「补转写」但仍未配置：明确失败，不自动重试
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { step: 'transcribe', code: 'transcriptionNotConfigured', retryable: false },
    })
    expect(t.source.meeting()?.status).toBe('failed')
  })

  it('keeps the transcript when no LLM is configured and adds the summary later', async () => {
    const t = setup({ services: { llm: { ok: false, issue: 'notConfigured' } } })
    let idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID, { auto: true })
    await idle
    expect(await t.job()).toMatchObject({
      state: 'done',
      summary: { state: 'skipped', reason: 'notConfigured' },
    })
    expect(t.folder.files.has(`${DIR}/transcript.json`)).toBe(true)
    expect(t.folder.files.has(`${DIR}/summary.md`)).toBe(false)
    expect((await t.folder.json(`${DIR}/meeting.json`)).providers).toEqual({
      transcription: 'fake-asr',
    })

    // 用户在结果页改了逐字稿（数据文件夹是唯一的真实数据）
    const editedTranscript = {
      ...transcript,
      segments: [{ ...transcript.segments[0]!, text: '用户修改后的逐字稿' }],
    }
    await t.folder.writeFile(`${DIR}/transcript.json`, JSON.stringify(editedTranscript))
    const editedMeeting = {
      ...(await t.folder.json(`${DIR}/meeting.json`)),
      title: '用户新标题',
      speakers: [{ id: '0', name: '自定义名字' }],
    }
    await t.folder.writeFile(`${DIR}/meeting.json`, JSON.stringify(editedMeeting))
    t.services.llm = { ok: true, provider: t.llm, config: {} }
    t.folder.writes = []
    idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', summary: { state: 'done' } })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    // 音视频大小没变不重写，已存在的逐字稿不覆盖
    expect(t.folder.writes.filter((p) => !p.endsWith('/.huilu-owner.json'))).toEqual([
      `${DIR}/summary.json`,
      `${DIR}/summary.md`,
      `${DIR}/meeting.json`,
    ])
    expect(await t.folder.json(`${DIR}/transcript.json`)).toEqual(editedTranscript)
    const request = vi.mocked(t.llm.generateObject).mock.calls[0]![0]
    expect(request.prompt).toContain('用户修改后的逐字稿')
    expect(request.prompt).toContain('用户新标题')
    expect(request.prompt).toContain('自定义名字')
    expect(request.prompt).not.toContain('我们开始今天的需求评审')
  })

  it('waits for folder authorization without losing results, then writes them', async () => {
    const t = setup()
    t.folder.ready = false
    await t.queue.enqueue(MEETING_ID, { auto: true })
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'waitingFolder', step: 'write' })
    expect(await t.work.json(`${MEETING_ID}/transcript.json`)).toEqual(transcript)
    expect(await t.work.json(`${MEETING_ID}/summary.json`)).toBeDefined()
    expect(await t.queue.isBusy()).toBe(false)
    expect(t.source.meeting()?.status).toBe('processing')

    t.folder.ready = true
    const idle = t.onIdle()
    await t.queue.onFolderAuthorized()
    await idle
    expect(await t.job()).toMatchObject({ state: 'done' })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    expect(t.llm.generateObject).toHaveBeenCalledTimes(1)
    expect(t.folder.files.has(`${DIR}/meeting.json`)).toBe(true)
  })

  it('treats a permission loss during the write as waiting for authorization', async () => {
    const t = setup()
    t.folder.writeFile = async () => {
      throw new DOMException('The request is not allowed', 'NotAllowedError')
    }
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'waitingFolder' })
  })

  it('retries rate limits with back-off and Retry-After', async () => {
    let calls = 0
    const t = setup({
      transcribe: async () => {
        if (++calls === 1) throw new ProviderError('rateLimited', 'slow down', 429, 90_000)
        return transcript
      },
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    const waiting = await t.job()
    expect(waiting).toMatchObject({
      state: 'queued',
      attempts: 1,
      nextAttemptAt: 1_000_000 + 90_000,
      error: { step: 'transcribe', code: 'rateLimited', detail: 'slow down', retryable: true },
    })
    expect(await t.queue.isBusy()).toBe(true)

    t.advance(90_000)
    const idle = t.onIdle()
    t.queue.kick()
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', attempts: 2, error: undefined })
  })

  /** 用户手测时智谱返回的原始响应体（HTTP 429 + 业务码 1113） */
  const ZHIPU_1113 = '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}'

  it('stops at a balance error in the summary step and resumes there after a manual retry', async () => {
    let broke = true
    const t = setup({
      generate: async () => {
        if (broke)
          throw new ProviderError(
            'quotaExceeded',
            '1113: 余额不足或无可用资源包,请充值。',
            429,
            30_000,
          )
        return summary
      },
    })
    let idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({
      state: 'failed',
      attempts: 1,
      nextAttemptAt: undefined,
      error: { step: 'summarize', code: 'quotaExceeded', retryable: false },
    })
    expect(t.source.meeting()?.status).toBe('failed')
    expect(await t.queue.isBusy()).toBe(false)
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)

    // 用户充值 / 换了服务后手动重试：从纪要继续，不重新转写
    broke = false
    idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', summary: { state: 'done' } })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    expect(t.llm.generateObject).toHaveBeenCalledTimes(2)
  })

  it('reclassifies a persisted legacy 1113 rate-limit retry on startup and cancels the timer', async () => {
    // 旧版本：1113 被当作限流，任务排队等待自动重试（逐字稿已在 OPFS）
    let legacy = true
    const t = setup({
      generate: async () => {
        if (legacy) throw new ProviderError('rateLimited', ZHIPU_1113, 429)
        return summary
      },
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    t.queue.stop()
    expect(await t.job()).toMatchObject({
      state: 'queued',
      nextAttemptAt: expect.any(Number),
      error: { step: 'summarize', code: 'rateLimited', detail: ZHIPU_1113, retryable: true },
    })
    legacy = false

    // 升级后离屏文档启动：改为需要用户处理的失败，不再调用大模型
    t.advance(24 * 3600_000)
    const upgraded = new ProcessingQueue(t.deps)
    await upgraded.start()
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'failed',
      nextAttemptAt: undefined,
      error: {
        step: 'summarize',
        code: 'quotaExceeded',
        detail: '1113: 余额不足或无可用资源包,请充值。',
        retryable: false,
      },
    })
    expect(t.source.meeting()?.status).toBe('failed')
    expect(t.llm.generateObject).toHaveBeenCalledTimes(1)
    expect(await upgraded.isBusy()).toBe(false)

    // 手动重试：从纪要继续
    const idle = t.onIdle()
    await upgraded.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', summary: { state: 'done' } })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    upgraded.stop()
  })

  it.each([
    ['a genuine rate limit', 'Rate limit reached'],
    ['a Zhipu 1302 rate limit', '{"error":{"code":"1302","message":"您的账户已达到速率限制"}}'],
    ['an unrecognized detail', '余额不足'],
  ])('leaves %s persisted by an older version scheduled for retry', async (_name, detail) => {
    const t = setup()
    const job = {
      meetingId: MEETING_ID,
      state: 'queued' as const,
      step: 'summarize' as const,
      attempts: 1,
      nextAttemptAt: 2_000_000,
      error: { step: 'summarize' as const, code: 'rateLimited', detail, retryable: true },
      checkpoints: {},
      createdAt: 1,
      updatedAt: 1,
    }
    await t.jobs.put(job)
    vi.spyOn(t.queue, 'kick').mockImplementation(() => {})
    await t.queue.start()
    expect(await t.job()).toMatchObject({
      state: 'queued',
      nextAttemptAt: 2_000_000,
      error: { code: 'rateLimited', detail },
    })
  })

  it('stops after the automatic attempts are used up and allows a manual retry', async () => {
    let fail = true
    const t = setup({
      transcribe: async () => {
        if (fail) throw new ProviderError('server', 'bad gateway', 502)
        return transcript
      },
    })
    await t.queue.enqueue(MEETING_ID)
    for (let i = 0; i < MAX_AUTO_ATTEMPTS; i++) {
      await t.settle()
      t.advance(10 * 60_000)
      t.queue.kick()
    }
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'failed',
      attempts: MAX_AUTO_ATTEMPTS,
      error: { code: 'server', retryable: false },
    })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(MAX_AUTO_ATTEMPTS)
    expect(t.source.meeting()?.status).toBe('failed')

    fail = false
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    expect(t.source.meeting()?.status).toBe('processing')
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', attempts: 1 })
  })

  it('does not retry configuration errors automatically', async () => {
    const t = setup({
      transcribe: async () => {
        throw new ProviderError('unauthorized', 'InvalidApiKey', 401)
      },
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { code: 'unauthorized', detail: 'InvalidApiKey' },
    })
  })

  it('resumes an interrupted job from its provider checkpoint after a restart', async () => {
    const t = setup({
      transcribe: async (_input, _config, ctx) => {
        expect(ctx.checkpoint?.get()).toEqual({ taskId: 'task-1' })
        return transcript
      },
    })
    // 上一个离屏文档在轮询途中被关闭（浏览器退出）
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'running',
      step: 'transcribe',
      attempts: 1,
      checkpoints: {
        transcriptionBinding: await fingerprint({
          version: 1,
          provider: 'fake-asr',
          config: { key: 'x' },
          input: { mimeType: 'audio/webm;codecs=opus', durationMs: 45000, language: 'zh' },
          size: 200,
        }),
        'transcribe:fake-asr': { taskId: 'task-1' },
      },
      createdAt: 1,
      updatedAt: 1,
    })
    const idle = t.onIdle()
    await t.queue.start()
    await idle
    expect(await t.job()).toMatchObject({ state: 'done' })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
  })

  it('does not spend the retry budget on repeated interrupted executions', async () => {
    const t = setup({
      transcribe: async () => {
        throw new ProviderError('timeout')
      },
    })
    // Persist the state that a process killed after #run's increment leaves behind.
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'running',
      attempts: 1,
      checkpoints: {},
      createdAt: 1,
      updatedAt: 1,
    })
    for (let i = 0; i < 6; i++) {
      const q = new ProcessingQueue(t.deps)
      vi.spyOn(q, 'kick').mockImplementation(() => {})
      await q.start()
      expect(await t.job()).toMatchObject({ state: 'queued', attempts: 0 })
      await t.jobs.put({ ...(await t.job())!, state: 'running', attempts: 1 })
    }
    await t.queue.start()
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'queued',
      attempts: 1,
      error: { code: 'timeout', retryable: true },
    })
    t.queue.stop()
  })

  it('retries startup recovery after reading the jobs fails, then finishes the interrupted job', async () => {
    const t = setup()
    t.deps.startRetryMs = 60_000
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'running',
      attempts: 2,
      checkpoints: {},
      createdAt: 1,
      updatedAt: 1,
    })
    const list = vi.spyOn(t.jobs, 'list').mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    await expect(t.queue.start()).rejects.toThrow('IndexedDB unavailable')
    expect(await t.job()).toMatchObject({ state: 'running', attempts: 2 })
    // offscreen:process 再次调用 start()：重新恢复，而不是只 kick 已卡住的 running 任务
    const idle = t.onIdle()
    await t.queue.start()
    await idle
    expect(list).toHaveBeenCalled()
    expect(await t.job()).toMatchObject({ state: 'done', attempts: 2 })
    expect(await t.queue.isBusy()).toBe(false)
    t.queue.stop()
  })

  it('retries startup recovery on its own after a folder permission check fails', async () => {
    const t = setup()
    t.deps.startRetryMs = 5
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'waitingFolder',
      attempts: 1,
      checkpoints: {},
      createdAt: 1,
      updatedAt: 1,
    })
    vi.spyOn(t.folder, 'isReady').mockRejectedValueOnce(new Error('permission query failed'))
    const idle = t.onIdle()
    await expect(t.queue.start()).rejects.toThrow('permission query failed')
    await idle
    expect(await t.job()).toMatchObject({ state: 'done' })
    t.queue.stop()
  })

  it('does not refund attempts twice for concurrent or partially completed recovery', async () => {
    const t = setup()
    t.deps.startRetryMs = 60_000
    for (const meetingId of ['a', 'b']) {
      await t.jobs.put({
        meetingId,
        state: 'running',
        attempts: 3,
        checkpoints: {},
        createdAt: 1,
        updatedAt: 1,
      })
    }
    const put = t.jobs.put.bind(t.jobs)
    let failB = true
    vi.spyOn(t.jobs, 'put').mockImplementation(async (job) => {
      if (job.meetingId === 'b' && failB) {
        failB = false
        throw new Error('write failed')
      }
      return put(job)
    })
    const kick = vi.spyOn(t.queue, 'kick').mockImplementation(() => {})
    await expect(t.queue.start()).rejects.toThrow('write failed')
    expect(await t.jobs.get('a')).toMatchObject({ state: 'queued', attempts: 2 })
    expect(await t.jobs.get('b')).toMatchObject({ state: 'running', attempts: 3 })
    await Promise.all([t.queue.start(), t.queue.start()])
    expect(await t.jobs.get('a')).toMatchObject({ state: 'queued', attempts: 2 })
    expect(await t.jobs.get('b')).toMatchObject({ state: 'queued', attempts: 2 })
    // 恢复完成后再调用只触发队列，不再改动任务
    await t.queue.start()
    expect(await t.jobs.get('a')).toMatchObject({ attempts: 2 })
    expect(kick).toHaveBeenCalled()
    t.queue.stop()
  })

  it('reschedules the pump after listing jobs fails instead of stalling', async () => {
    const t = setup()
    const list = t.jobs.list.bind(t.jobs)
    let failures = 1
    vi.spyOn(t.jobs, 'list').mockImplementation(async () => {
      if (failures-- > 0) throw new Error('IndexedDB transaction aborted')
      return list()
    })
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', attempts: 1 })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    t.queue.stop()
  })

  it('clears the current job and retries when marking it running fails', async () => {
    const t = setup()
    const put = t.jobs.put.bind(t.jobs)
    let failRunning = true
    vi.spyOn(t.jobs, 'put').mockImplementation(async (job) => {
      if (job.state === 'running' && failRunning) {
        failRunning = false
        throw new Error('QuotaExceededError')
      }
      return put(job)
    })
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done' })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    expect(await t.queue.isBusy()).toBe(false)
    t.queue.stop()
  })

  it('requeues a job left running when saving its result fails, without transcribing again', async () => {
    const t = setup()
    const put = t.jobs.put.bind(t.jobs)
    // 保存 done 失败，随后 #fail 记录这次失败时存储仍不可用：持久化状态停在 running
    let failing = 0
    let armed = true
    vi.spyOn(t.jobs, 'put').mockImplementation(async (job) => {
      if (job.state === 'done' && armed) {
        armed = false
        failing = 2
      }
      if (failing > 0) {
        failing--
        throw new Error('IndexedDB write failed')
      }
      return put(job)
    })
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', attempts: 2 })
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    expect(t.llm.generateObject).toHaveBeenCalledTimes(1)
    t.queue.stop()
  })

  it('backs off on persistent storage failures and stops retrying after stop()', async () => {
    const t = setup()
    t.deps.storageRetryMs = 10
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'queued',
      attempts: 0,
      checkpoints: {},
      createdAt: 1,
      updatedAt: 1,
    })
    const list = vi.spyOn(t.jobs, 'list').mockRejectedValue(new Error('IndexedDB unavailable'))
    t.queue.kick()
    await new Promise((r) => setTimeout(r, 120))
    // 间隔 10 / 20 / 40 / 80 ms：120 ms 内最多约 4 轮（每轮执行循环与 isBusy 各读一次），而不是忙循环
    const calls = list.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(calls).toBeLessThanOrEqual(10)
    t.queue.stop()
    const stoppedAt = list.mock.calls.length
    await new Promise((r) => setTimeout(r, 200))
    expect(list.mock.calls.length).toBe(stoppedAt)

    // 存储恢复后重新启动：继续执行
    list.mockRestore()
    const idle = t.onIdle()
    await t.queue.start()
    await idle
    expect(await t.job()).toMatchObject({ state: 'done' })
    t.queue.stop()
  })

  it.each([true, false])(
    'reconciles waiting jobs against actual folder permission (%s)',
    async (ready) => {
      const t = setup()
      t.folder.ready = false
      await t.queue.enqueue(MEETING_ID)
      await t.settle()
      t.queue.stop()
      t.folder.ready = ready
      const q = new ProcessingQueue(t.deps)
      await q.start()
      await t.settle()
      expect(await t.job()).toMatchObject({ state: ready ? 'done' : 'waitingFolder' })
      expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
      q.stop()
    },
  )

  it('returns to the queue without counting an attempt when stopped', async () => {
    let release!: () => void
    const t = setup({
      transcribe: (_input, _config, ctx) =>
        new Promise((_resolve, reject) => {
          release = () => reject(new ProviderError('aborted'))
          if (ctx.signal.aborted) release()
          ctx.signal.addEventListener('abort', () => release())
        }),
    })
    await t.queue.enqueue(MEETING_ID)
    await vi.waitFor(async () => expect((await t.job())?.state).toBe('running'))
    t.queue.stop()
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'queued', attempts: 0 })
  })

  it('splits audio over the provider limit and merges the timeline, reusing finished pieces', async () => {
    const plan = vi.fn(async () => [0, 10, 20, 25])
    const cut = vi.fn(async (_blob: Blob, start: number, end: number) => ({
      blob: new Blob([new Uint8Array(Math.round((end - start) * 8))]),
      mimeType: 'audio/webm;codecs=opus',
    }))
    let calls = 0
    const t = setup({
      maxFileBytes: 100,
      splitter: { plan, cut },
      transcribe: async (input) => {
        calls++
        if (calls === 3) throw new ProviderError('network', 'offline')
        return {
          language: 'zh',
          segments: [
            { startMs: 500, endMs: 1500, speakerId: '0', text: `片段${input.durationMs}` },
          ],
        }
      },
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'queued', error: { code: 'network' } })
    expect(plan).toHaveBeenCalledWith(expect.any(Blob), 90)

    t.advance(60_000)
    const idle = t.onIdle()
    t.queue.kick()
    await idle
    expect(plan).toHaveBeenCalledTimes(1)
    // 第 1、2 片的结果已保存，重试只转写第 3 片
    expect(calls).toBe(4)
    expect(cut.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
      [20, 25],
    ])
    const merged = Transcript.parse(await t.work.json(`${MEETING_ID}/transcript.json`))
    expect(merged.segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [500, 1500, '片段10000'],
      [10_500, 11_500, '片段10000'],
      [20_500, 21_500, '片段5000'],
    ])
  })

  it.each(['model', 'baseUrl', 'apiKey', 'plan', 'invalidPlan', 'unchanged'])(
    'binds pieces and provider checkpoints to configuration and split plan: %s',
    async (change) => {
      let fail = true
      let calls = 0
      const plan = vi.fn(async () => [0, 10, 20])
      const t = setup({
        maxFileBytes: 100,
        splitter: {
          plan,
          cut: async () => ({ blob: new Blob(['piece']), mimeType: 'audio/webm' }),
        },
        transcribe: async (_input, _config, ctx) => {
          calls++
          if (calls === 2 && fail) {
            await ctx.checkpoint?.set({ taskId: 'old-task' })
            throw new ProviderError('network')
          }
          if (!fail)
            expect(ctx.checkpoint?.get()).toEqual(
              change === 'unchanged' ? { taskId: 'old-task' } : undefined,
            )
          return transcript
        },
      })
      const config = { model: 'old-model', baseUrl: 'https://old.invalid', apiKey: 'secret-old' }
      t.services.transcription = { ok: true, provider: t.transcription, config }
      await t.queue.enqueue(MEETING_ID)
      await t.settle()
      expect(calls).toBe(2)
      fail = false
      if (['model', 'baseUrl', 'apiKey'].includes(change)) {
        t.services.transcription = {
          ok: true,
          provider: t.transcription,
          config: { ...config, [change]: 'changed-secret' },
        }
      } else if (change === 'plan' || change === 'invalidPlan') {
        const job = (await t.job())!
        job.checkpoints['split:90'] = change === 'plan' ? [0, 5, 20] : [0, 10, 10]
        if (change === 'invalidPlan') plan.mockResolvedValue([0, 5, 20])
        await t.jobs.put(job)
      } else {
        t.services.transcription = {
          ok: true,
          provider: t.transcription,
          config: { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model },
        }
      }
      t.advance(60000)
      t.queue.kick()
      await t.settle()
      expect(await t.job()).toMatchObject({ state: 'done' })
      expect(calls).toBe(change === 'unchanged' ? 3 : 4)
      for (const blob of t.work.files.values()) {
        expect(await blob.text()).not.toContain('secret-old')
        expect(await blob.text()).not.toContain('changed-secret')
      }
      expect(JSON.stringify(await t.job())).not.toContain('secret-old')
      expect(JSON.stringify(await t.job())).not.toContain('changed-secret')
    },
  )

  it('discards legacy unbound checkpoints rather than sending them to a new configuration', async () => {
    const t = setup({
      transcribe: async (_input, _config, ctx) => {
        expect(ctx.checkpoint?.get()).toBeUndefined()
        return transcript
      },
    })
    await t.jobs.put({
      meetingId: MEETING_ID,
      state: 'running',
      attempts: 1,
      checkpoints: { 'transcribe:fake-asr': { taskId: 'legacy' } },
      createdAt: 1,
      updatedAt: 1,
    })
    await t.queue.start()
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'done' })
  })

  it('does not overwrite another meeting that owns the same folder name', async () => {
    const t = setup()
    await t.folder.writeFile(`${DIR}/meeting.json`, JSON.stringify({ id: 'someone-else' }))
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', folderDir: `${DIR} (2)` })
    expect(await t.folder.json(`${DIR}/meeting.json`)).toEqual({ id: 'someone-else' })
    expect(t.folder.files.has(`${DIR} (2)/transcript.json`)).toBe(true)
  })

  it('skips a candidate folder name occupied by a regular file', async () => {
    const t = setup()
    const read = t.folder.readFile.bind(t.folder)
    vi.spyOn(t.folder, 'readFile').mockImplementation(async (path) => {
      // `${DIR}` is a file at the root: traversing it as a directory fails like the real API.
      if (path.startsWith(`${DIR}/`)) throw new DOMException('not a directory', 'TypeMismatchError')
      return read(path)
    })
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', folderDir: `${DIR} (2)` })
    expect(t.folder.files.has(`${DIR} (2)/meeting.json`)).toBe(true)
    expect(t.folder.writes.some((p) => p.startsWith(`${DIR}/`))).toBe(false)
  })

  it.each([
    [
      'an IO error',
      () => new DOMException('disk error', 'NotReadableError'),
      { error: { code: 'writeFailed' } },
    ],
    ['a permission loss', () => new FolderNotReadyError('prompt'), { state: 'waitingFolder' }],
  ])('does not skip a candidate folder on %s', async (_name, error, expected) => {
    const t = setup()
    const read = t.folder.readFile.bind(t.folder)
    vi.spyOn(t.folder, 'readFile').mockImplementation(async (path) => {
      if (path === `${DIR}/meeting.json`) throw error()
      return read(path)
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    const job = await t.job()
    expect(job).toMatchObject(expected)
    expect(job?.state).not.toBe('done')
    expect(job?.folderDir).toBeUndefined()
    expect(t.folder.writes.some((p) => p.startsWith(`${DIR} (2)/`))).toBe(false)
    t.queue.stop()
  })

  it('rechecks a cached directory after switching to a folder owned by another meeting', async () => {
    const t = setup()
    let idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    // The user selects a different root containing an identically named directory.
    t.folder.files.clear()
    const other = meeting({ id: 'other', title: 'Do not overwrite', status: 'ready' })
    await t.folder.writeFile(`${DIR}/meeting.json`, JSON.stringify(other))
    await t.folder.writeFile(`${DIR}/audio.webm`, 'unrelated audio')
    idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({
      state: 'failed',
      error: { code: 'sourceDataUnavailable' },
    })
    expect(await t.folder.json(`${DIR}/meeting.json`)).toEqual(other)
    expect(await t.folder.text(`${DIR}/audio.webm`)).toBe('unrelated audio')
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
  })

  it('reserves a partial directory before a failed write so another job cannot adopt it', async () => {
    const first = setup()
    const write = first.folder.writeFile.bind(first.folder)
    vi.spyOn(first.folder, 'writeFile').mockImplementation(async (path, data) => {
      if (path.endsWith('/summary.md')) throw new Error('disk unavailable')
      await write(path, data)
    })
    await first.queue.enqueue(MEETING_ID)
    await first.settle()
    first.queue.stop()
    expect(first.folder.files.has(`${DIR}/meeting.json`)).toBe(false)
    expect(await first.folder.json(`${DIR}/.huilu-owner.json`)).toMatchObject({ id: MEETING_ID })
    vi.mocked(first.folder.writeFile).mockImplementation(write)
    const second = setup({ meeting: meeting({ id: 'second' }) })
    second.deps.folder = first.folder
    const idle = second.onIdle()
    await second.queue.enqueue('second')
    await idle
    expect(await second.jobs.get('second')).toMatchObject({
      state: 'done',
      folderDir: `${DIR} (2)`,
    })
    expect(await first.folder.json(`${DIR}/.huilu-owner.json`)).toMatchObject({ id: MEETING_ID })
  })

  it('preserves unowned partial artifacts instead of mixing them into a new meeting', async () => {
    const t = setup()
    await t.folder.writeFile(`${DIR}/transcript.json`, 'unrelated partial transcript')
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({ state: 'done', folderDir: `${DIR} (2)` })
    expect(await t.folder.text(`${DIR}/transcript.json`)).toBe('unrelated partial transcript')
  })

  it.each(['notes.md', 'video.webm', 'audio.m4a', 'empty-subdirectory/'])(
    'does not claim a directory containing unrelated %s',
    async (name) => {
      const t = setup()
      if (name.endsWith('/')) t.folder.directories.add(`${DIR}/${name}`)
      else await t.folder.writeFile(`${DIR}/${name}`, 'untouched')
      await t.queue.enqueue(MEETING_ID)
      await t.settle()
      expect(await t.job()).toMatchObject({ state: 'done', folderDir: `${DIR} (2)` })
      expect(t.folder.files.has(`${DIR}/.huilu-owner.json`)).toBe(false)
      if (!name.endsWith('/')) expect(await t.folder.text(`${DIR}/${name}`)).toBe('untouched')
    },
  )

  it.each(['transcript.json', 'summary.json', 'summary.md'])(
    'repairs empty and partial %s after a failed or silently incomplete write',
    async (name) => {
      for (const partial of ['', '{"partial":', '# cut off']) {
        const t = setup()
        const write = t.folder.writeFile.bind(t.folder)
        let failed = false
        vi.spyOn(t.folder, 'writeFile').mockImplementation(async (path, data) => {
          if (path === `${DIR}/${name}` && !failed) {
            failed = true
            await write(path, partial)
            if (partial !== '# cut off') throw new Error('disk full')
            return
          }
          await write(path, data)
        })
        await t.queue.enqueue(MEETING_ID)
        await t.settle()
        expect(await t.job()).toMatchObject({ state: 'queued', error: { code: 'writeFailed' } })
        expect(t.folder.files.has(`${DIR}/meeting.json`)).toBe(false)
        t.advance(60000)
        t.queue.kick()
        await t.settle()
        expect(await t.job()).toMatchObject({ state: 'done' })
        expect(Transcript.parse(await t.folder.json(`${DIR}/transcript.json`))).toEqual(transcript)
        expect(Summary.safeParse(await t.folder.json(`${DIR}/summary.json`)).success).toBe(true)
        expect(await t.folder.text(`${DIR}/summary.md`)).toContain('## 待办事项')
        expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
        expect(t.llm.generateObject).toHaveBeenCalledTimes(1)
      }
    },
  )

  it('repairs a partial summary backfill even with an existing ready meeting.json', async () => {
    const t = setup({ services: { llm: { ok: false, issue: 'notConfigured' } } })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    t.services.llm = { ok: true, provider: t.llm, config: {} }
    const write = t.folder.writeFile.bind(t.folder)
    let failed = false
    vi.spyOn(t.folder, 'writeFile').mockImplementation(async (path, data) => {
      if (path.endsWith('/summary.md') && !failed) {
        failed = true
        await write(path, '# truncated')
        throw new Error('disk full')
      }
      await write(path, data)
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'queued' })
    t.advance(60000)
    t.queue.kick()
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'done' })
    expect(await t.folder.text(`${DIR}/summary.md`)).toContain('## 待办事项')
    expect(t.llm.generateObject).toHaveBeenCalledTimes(1)

    const editedSummary = { ...summary, overview: '用户修改的概要' }
    await write(`${DIR}/summary.json`, JSON.stringify(editedSummary))
    await write(`${DIR}/summary.md`, '# 用户自行整理的纪要')
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.folder.json(`${DIR}/summary.json`)).toEqual(editedSummary)
    expect(await t.folder.text(`${DIR}/summary.md`)).toBe('# 用户自行整理的纪要')
    expect(t.llm.generateObject).toHaveBeenCalledTimes(1)
  })

  it('regenerates an uncommitted summary when the authoritative transcript changes before retry', async () => {
    const t = setup({ services: { llm: { ok: false, issue: 'notConfigured' } } })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    t.services.llm = { ok: true, provider: t.llm, config: {} }
    const write = t.folder.writeFile.bind(t.folder)
    let fail = true
    vi.spyOn(t.folder, 'writeFile').mockImplementation(async (path, data) => {
      if (path.endsWith('/meeting.json') && fail) throw new Error('disk full')
      await write(path, data)
    })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'queued' })
    await write(
      `${DIR}/transcript.json`,
      JSON.stringify({ ...transcript, segments: [{ ...transcript.segments[0]!, text: '新输入' }] }),
    )
    vi.mocked(t.llm.generateObject).mockImplementation(async (request) => {
      expect(request.prompt).toContain('新输入')
      return request.schema.parse({ ...summary, overview: '新输入的概要' })
    })
    fail = false
    t.advance(60000)
    t.queue.kick()
    await t.settle()
    expect(await t.job()).toMatchObject({ state: 'done' })
    expect((await t.folder.json(`${DIR}/summary.json`)).overview).toBe('新输入的概要')
    expect(await t.folder.text(`${DIR}/summary.md`)).toContain('新输入的概要')
    expect(t.llm.generateObject).toHaveBeenCalledTimes(2)
  })

  it.each(['permission', 'missing', 'corruptTranscript', 'corruptMetadata', 'wrongOwner'])(
    'never falls back to cached data for an unavailable completed source: %s',
    async (reason) => {
      const t = setup({ services: { llm: { ok: false, issue: 'notConfigured' } } })
      await t.queue.enqueue(MEETING_ID)
      await t.settle()
      t.services.llm = { ok: true, provider: t.llm, config: {} }
      if (reason === 'permission') t.folder.ready = false
      if (reason === 'missing') t.folder.files.clear()
      if (reason === 'corruptTranscript') await t.folder.writeFile(`${DIR}/transcript.json`, '{bad')
      if (reason === 'corruptMetadata') await t.folder.writeFile(`${DIR}/meeting.json`, '{bad')
      if (reason === 'wrongOwner')
        await t.folder.writeFile(`${DIR}/.huilu-owner.json`, '{"id":"other"}')
      t.folder.writes = []
      await t.queue.enqueue(MEETING_ID)
      await t.settle()
      expect(await t.job()).toMatchObject(
        reason === 'permission'
          ? { state: 'waitingFolder' }
          : { state: 'failed', error: { code: 'sourceDataUnavailable', retryable: false } },
      )
      expect(t.llm.generateObject).not.toHaveBeenCalled()
      expect(t.folder.writes).toEqual([])
      if (reason === 'permission') {
        t.folder.ready = true
        await t.queue.onFolderAuthorized()
        await t.settle()
        expect(await t.job()).toMatchObject({ state: 'done' })
      }
    },
  )

  it('detects edits made while generating a follow-up summary before writing anything', async () => {
    const t = setup({ services: { llm: { ok: false, issue: 'notConfigured' } } })
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    vi.mocked(t.llm.generateObject).mockImplementation(async (request) => {
      await t.folder.writeFile(
        `${DIR}/transcript.json`,
        JSON.stringify({ ...transcript, segments: [] }),
      )
      return request.schema.parse(summary)
    })
    t.services.llm = { ok: true, provider: t.llm, config: {} }
    await t.queue.enqueue(MEETING_ID)
    await t.settle()
    expect(await t.job()).toMatchObject({
      state: 'failed',
      error: { code: 'sourceDataUnavailable' },
    })
    expect(t.folder.files.has(`${DIR}/summary.json`)).toBe(false)
  })

  it('keeps speaker names and titles the user edited in the folder', async () => {
    const t = setup()
    const edited = {
      ...meeting({ title: '改过的标题', status: 'ready' }),
      speakers: [{ id: '0', name: '王经理' }],
    }
    await t.folder.writeFile(`${DIR}/meeting.json`, JSON.stringify(edited))
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    const written = Meeting.parse(await t.folder.json(`${DIR}/meeting.json`))
    expect(written).toMatchObject({
      title: '改过的标题',
      speakers: [{ id: '0', name: '王经理' }],
      providers: { transcription: 'fake-asr', llm: 'fake-llm' },
    })
  })

  it('skips the summary for an empty transcript instead of letting the model invent one', async () => {
    const t = setup({ transcribe: async () => ({ language: 'zh', segments: [] }) })
    const idle = t.onIdle()
    await t.queue.enqueue(MEETING_ID)
    await idle
    expect(await t.job()).toMatchObject({
      state: 'done',
      summary: { state: 'skipped', reason: 'emptyTranscript' },
    })
    expect(t.llm.generateObject).not.toHaveBeenCalled()
  })

  it('is idempotent: enqueueing an active job twice runs it once', async () => {
    const t = setup()
    const idle = t.onIdle()
    await Promise.all([t.queue.enqueue(MEETING_ID), t.queue.enqueue(MEETING_ID)])
    await idle
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
    // 已有任务时录制结束的自动加入不会让已完成的任务重跑
    await t.queue.enqueue(MEETING_ID, { auto: true })
    await t.settle()
    expect(t.transcription.transcribe).toHaveBeenCalledTimes(1)
  })
})

it('runs a persisted job even when the initial source status update fails', async () => {
  const t = setup({ meeting: meeting({ status: 'failed' }) })
  vi.spyOn(t.source, 'writeMeeting').mockRejectedValueOnce(new Error('source write failed'))
  const idle = t.onIdle()
  await expect(t.queue.enqueue(MEETING_ID)).rejects.toThrow('source write failed')
  await idle
  expect(await t.job()).toMatchObject({ state: 'done' })
  t.queue.stop()
})

it('retries folder reconciliation when saving a newly authorized job fails', async () => {
  const t = setup()
  t.deps.startRetryMs = 5
  await t.jobs.put({
    meetingId: MEETING_ID,
    state: 'waitingFolder',
    attempts: 1,
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
  })
  vi.spyOn(t.jobs, 'put').mockRejectedValueOnce(new Error('idb write failed'))
  const idle = t.onIdle()
  await expect(t.queue.onFolderAuthorized()).rejects.toThrow('idb write failed')
  await idle
  expect(await t.job()).toMatchObject({ state: 'done' })
  t.queue.stop()
})
