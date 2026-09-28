// 转写 / 纪要的请求回放测试：fetch 按 URL 返回 __fixtures__ 中的响应，不发真实请求、不花钱
import { Summary, generalSummaryTemplate, type Checkpoint } from '@huilu/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import chatSummary from './__fixtures__/chat-summary.json'
import groqVerbose from './__fixtures__/groq-verbose.json'
import policy from './__fixtures__/paraformer-policy.json'
import result from './__fixtures__/paraformer-result.json'
import running from './__fixtures__/paraformer-running.json'
import submitted from './__fixtures__/paraformer-submit.json'
import succeeded from './__fixtures__/paraformer-succeeded.json'
import {
  PARAFORMER_LIMITS,
  ProviderError,
  openAiCompatibleLlm,
  openAiCompatibleTranscription,
  paraformer,
  type ParaformerCheckpoint,
} from './index'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: BodyInit | null | undefined
}

type Route = (call: Call) => Response | Promise<Response>

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

/** 依次匹配路由；每个路由返回 undefined 表示不处理 */
function replay(routes: [RegExp, Route][]) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url: String(input),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: init?.body,
      }
      calls.push(call)
      if (init?.signal?.aborted) throw init.signal.reason
      const route = routes.find(([re]) => re.test(`${call.method} ${call.url}`))
      if (!route) throw new TypeError(`unexpected request ${call.method} ${call.url}`)
      return route[1](call)
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const audio = (bytes = 1024) => ({
  blob: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }),
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 45_000,
  language: 'zh',
})

function memoryCheckpoint(initial?: unknown): Checkpoint & { value: unknown } {
  return {
    value: initial,
    get() {
      return this.value
    },
    async set(v) {
      this.value = v
    },
  }
}

const noWait = () => {
  vi.spyOn(PARAFORMER_LIMITS, 'pollIntervalMs', 'get').mockReturnValue(0)
}

describe('paraformer.transcribe', () => {
  const config = paraformer.configSchema.parse({ apiKey: 'sk-test' })

  function paraformerRoutes(polls: unknown[] = [running, succeeded]) {
    let poll = 0
    return replay([
      [/GET .*\/api\/v1\/uploads\?action=getPolicy&model=paraformer-v2$/, () => json(policy)],
      [/POST https:\/\/dashscope-file-mgr\./, () => new Response('', { status: 200 })],
      [/POST .*\/api\/v1\/services\/audio\/asr\/transcription$/, () => json(submitted)],
      [/GET .*\/api\/v1\/tasks\/task-0001$/, () => json(polls[Math.min(poll++, polls.length - 1)])],
      [/GET https:\/\/dashscope-result-bj\./, () => json(result)],
    ])
  }

  it('uploads, submits with diarization, polls and maps sentences', async () => {
    noWait()
    const calls = paraformerRoutes()
    const checkpoint = memoryCheckpoint()
    const transcript = await paraformer.transcribe(audio(), config, {
      signal: new AbortController().signal,
      checkpoint,
    })

    expect(transcript).toEqual({
      language: 'zh',
      segments: [
        { startMs: 760, endMs: 3240, speakerId: '0', text: '我们开始今天的需求评审。' },
        { startMs: 3900, endMs: 6120, speakerId: '1', text: '好的，先看登录页。' },
        { startMs: 30000, endMs: 34500, speakerId: '0', text: '登录页下周三前出设计稿。' },
      ],
    })
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v1/uploads',
      'POST /',
      'POST /api/v1/services/audio/asr/transcription',
      'GET /api/v1/tasks/task-0001',
      'GET /api/v1/tasks/task-0001',
      'GET /prod/paraformer-v2/task-0001.json',
    ])

    // OSS 表单上传：file 必须是最后一个字段，key 在凭证给出的目录下
    const form = calls[1]!.body as FormData
    const keys = [...form.keys()]
    expect(keys.at(-1)).toBe('file')
    expect(String(form.get('key'))).toMatch(
      /^dashscope-instant\/abc123\/2026-09-28\/xyz\/huilu-\d+\.webm$/,
    )
    expect(calls[1]!.headers.authorization).toBeUndefined()

    const submit = calls[2]!
    expect(submit.headers).toMatchObject({
      authorization: 'Bearer sk-test',
      'x-dashscope-async': 'enable',
      'x-dashscope-ossresourceresolve': 'enable',
    })
    expect(JSON.parse(String(submit.body))).toEqual({
      model: 'paraformer-v2',
      input: { file_urls: [expect.stringMatching(/^oss:\/\/dashscope-instant\/abc123\//)] },
      parameters: { diarization_enabled: true, language_hints: ['zh', 'en'] },
    })
    // 结果文件地址自带签名，不能把百炼的 Key 发给 OSS
    expect(calls[5]!.headers.authorization).toBeUndefined()
    expect(checkpoint.value).toMatchObject({ taskId: 'task-0001', region: 'cn' })
  })

  it('resumes polling an already submitted task without uploading again', async () => {
    noWait()
    const calls = paraformerRoutes([succeeded])
    const checkpoint = memoryCheckpoint({
      region: 'cn',
      model: 'paraformer-v2',
      fileUrl: 'oss://dashscope-instant/abc123/old.webm',
      uploadedAt: Date.now() - 60_000,
      taskId: 'task-0001',
      submittedAt: Date.now() - 30_000,
    } satisfies ParaformerCheckpoint)
    const transcript = await paraformer.transcribe(audio(), config, {
      signal: new AbortController().signal,
      checkpoint,
    })
    expect(transcript.segments).toHaveLength(3)
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/v1/tasks/task-0001',
      '/prod/paraformer-v2/task-0001.json',
    ])
  })

  it('reuses a still valid upload but resubmits when the task is gone', async () => {
    noWait()
    const calls = paraformerRoutes([succeeded])
    const fileUrl = 'oss://dashscope-instant/abc123/old.webm'
    const checkpoint = memoryCheckpoint({
      region: 'cn',
      model: 'paraformer-v2',
      fileUrl,
      uploadedAt: Date.now() - 30 * 3600_000,
      taskId: 'task-expired',
      submittedAt: Date.now() - 25 * 3600_000,
    } satisfies ParaformerCheckpoint)
    await paraformer.transcribe(audio(), config, {
      signal: new AbortController().signal,
      checkpoint,
    })
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/v1/services/audio/asr/transcription',
      '/api/v1/tasks/task-0001',
      '/prod/paraformer-v2/task-0001.json',
    ])
    expect(JSON.parse(String(calls[0]!.body)).input.file_urls).toEqual([fileUrl])
  })

  it('uploads again when the temporary file expired or the model changed', async () => {
    noWait()
    for (const saved of [
      {
        region: 'cn',
        model: 'paraformer-v2',
        fileUrl: 'oss://x',
        uploadedAt: Date.now() - 49 * 3600_000,
      },
      { region: 'cn', model: 'paraformer-8k-v2', fileUrl: 'oss://x', uploadedAt: Date.now() },
    ]) {
      const calls = paraformerRoutes([succeeded])
      await paraformer.transcribe(audio(), config, {
        signal: new AbortController().signal,
        checkpoint: memoryCheckpoint(saved),
      })
      expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/uploads')
    }
  })

  it('keeps the checkpoint when polling fails so a retry does not re-upload', async () => {
    noWait()
    replay([
      [/getPolicy/, () => json(policy)],
      [/POST https:\/\/dashscope-file-mgr\./, () => new Response('', { status: 200 })],
      [/transcription$/, () => json(submitted)],
      [/tasks\//, () => new Response('bad gateway', { status: 502 })],
    ])
    const checkpoint = memoryCheckpoint()
    const err = await paraformer
      .transcribe(audio(), config, { signal: new AbortController().signal, checkpoint })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'server', status: 502 })
    expect(checkpoint.value).toMatchObject({ taskId: 'task-0001', fileUrl: expect.any(String) })
  })

  it('resubmits a terminally failed task on explicit retry without re-uploading', async () => {
    noWait()
    const calls = paraformerRoutes([
      { output: { task_status: 'FAILED', code: 'InternalError', message: 'failed' } },
      succeeded,
    ])
    const checkpoint = memoryCheckpoint()
    const ctx = { signal: new AbortController().signal, checkpoint }
    await expect(paraformer.transcribe(audio(), config, ctx)).rejects.toMatchObject({
      code: 'taskFailed',
    })
    expect(checkpoint.value).toMatchObject({ fileUrl: expect.any(String) })
    expect((checkpoint.value as ParaformerCheckpoint).taskId).toBeUndefined()
    await expect(paraformer.transcribe(audio(), config, ctx)).resolves.toMatchObject({
      segments: expect.any(Array),
    })
    expect(calls.filter((c) => c.url.includes('/uploads?'))).toHaveLength(1)
    expect(calls.filter((c) => c.url.endsWith('/asr/transcription'))).toHaveLength(2)
  })

  it('omits language_hints for models other than paraformer-v2', async () => {
    noWait()
    const calls = replay([
      [/getPolicy/, () => json(policy)],
      [/POST https:\/\/dashscope-file-mgr\./, () => new Response('', { status: 200 })],
      [/POST .*\/asr\/transcription$/, () => json(submitted)],
      [/GET .*\/tasks\//, () => json(succeeded)],
      [/GET https:\/\/dashscope-result-bj\./, () => json(result)],
    ])
    await paraformer.transcribe(
      audio(),
      { ...config, model: 'paraformer-8k-v2' },
      {
        signal: new AbortController().signal,
      },
    )
    const call = calls.find((c) => c.url.endsWith('/asr/transcription'))!
    expect(JSON.parse(String(call.body)).parameters).not.toHaveProperty('language_hints')
  })

  it('reports failed tasks with the provider code', async () => {
    noWait()
    paraformerRoutes([
      {
        output: {
          task_id: 'task-0001',
          task_status: 'SUCCEEDED',
          results: [
            {
              subtask_status: 'FAILED',
              code: 'InvalidFile.DecodeFailed',
              message: 'decode failed',
            },
          ],
        },
      },
    ])
    const err = await paraformer
      .transcribe(audio(), config, { signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({
      code: 'taskFailed',
      detail: 'InvalidFile.DecodeFailed: decode failed',
    })
  })

  function resultRoutes(body: string) {
    return replay([
      [/GET .*\/api\/v1\/tasks\/task-0001$/, () => json(succeeded)],
      [/GET https:\/\/dashscope-result-bj\./, () => new Response(body)],
    ])
  }
  const resumed = () =>
    memoryCheckpoint({
      region: 'cn',
      model: 'paraformer-v2',
      fileUrl: 'oss://dashscope-instant/abc123/old.webm',
      uploadedAt: Date.now() - 60_000,
      taskId: 'task-0001',
      submittedAt: Date.now() - 30_000,
    } satisfies ParaformerCheckpoint)
  const sentence = (fields: Record<string, unknown>) =>
    JSON.stringify({ transcripts: [{ sentences: [{ text: '你好', speaker_id: 0, ...fields }] }] })

  it.each([
    ['missing begin_time', sentence({ end_time: 100 })],
    ['missing end_time', sentence({ begin_time: 100 })],
    ['string timestamp', sentence({ begin_time: '100', end_time: 200 })],
    ['null timestamp', sentence({ begin_time: null, end_time: 200 })],
    ['non-finite timestamp', '{"transcripts":[{"sentences":[{"text":"x","begin_time":0,"end_time":1e400}]}]}'],
    ['negative timestamp', sentence({ begin_time: -5, end_time: 200 })],
    ['reversed timestamps', sentence({ begin_time: 300, end_time: 200 })],
    ['malformed speaker', sentence({ begin_time: 0, end_time: 200, speaker_id: 'a' })],
    ['non-object result', 'null'],
    ['non-array transcripts', JSON.stringify({ transcripts: {} })],
  ])('rejects a downloaded result with %s as badResponse', async (_name, body) => {
    noWait()
    resultRoutes(body)
    await expect(
      paraformer.transcribe(audio(), config, {
        signal: new AbortController().signal,
        checkpoint: resumed(),
      }),
    ).rejects.toMatchObject({ code: 'badResponse' })
  })

  it('accepts zero-length, overlapping and empty Paraformer results', async () => {
    noWait()
    resultRoutes(
      JSON.stringify({
        transcripts: [
          {
            sentences: [
              { begin_time: 500, end_time: 900, text: '重叠', speaker_id: 1 },
              { begin_time: 100, end_time: 100, text: '零长', speaker_id: 0 },
              { begin_time: 400, end_time: 600.4, text: '  ' },
            ],
          },
        ],
      }),
    )
    const transcript = await paraformer.transcribe(audio(), config, {
      signal: new AbortController().signal,
      checkpoint: resumed(),
    })
    expect(transcript.segments).toEqual([
      { startMs: 100, endMs: 100, speakerId: '0', text: '零长' },
      { startMs: 500, endMs: 900, speakerId: '1', text: '重叠' },
    ])
    resultRoutes(JSON.stringify({ transcripts: [] }))
    await expect(
      paraformer.transcribe(audio(), config, {
        signal: new AbortController().signal,
        checkpoint: resumed(),
      }),
    ).resolves.toEqual({ language: 'zh', segments: [] })
  })

  it('rejects files over the upload policy limit before uploading', async () => {
    const calls = paraformerRoutes()
    const err = await paraformer
      .transcribe(audio(101 * 2 ** 20), config, { signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'fileTooLarge' })
    expect(calls).toHaveLength(1)
  })

  it('surfaces 429 with Retry-After', async () => {
    replay([
      [
        /getPolicy/,
        () => json({ code: 'Throttling', message: 'slow down' }, 429, { 'retry-after': '7' }),
      ],
    ])
    const err = await paraformer
      .transcribe(audio(), config, { signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ code: 'rateLimited', retryAfterMs: 7000 })
  })

  it('stops polling when aborted', async () => {
    replay([[/tasks\//, () => json(running)]])
    const controller = new AbortController()
    const promise = paraformer.transcribe(audio(), config, {
      signal: controller.signal,
      checkpoint: memoryCheckpoint({
        region: 'cn',
        model: 'paraformer-v2',
        fileUrl: 'oss://x',
        uploadedAt: Date.now(),
        taskId: 'task-0001',
        submittedAt: Date.now(),
      }),
    })
    setTimeout(() => controller.abort(), 20)
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('openAiCompatibleTranscription.transcribe', () => {
  const groq = openAiCompatibleTranscription.configSchema.parse({
    preset: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1/',
    apiKey: 'gsk-test',
    model: 'whisper-large-v3-turbo',
  })

  it('posts multipart verbose_json and maps segments to a single speaker', async () => {
    const calls = replay([[/POST .*\/audio\/transcriptions$/, () => json(groqVerbose)]])
    const transcript = await openAiCompatibleTranscription.transcribe(audio(), groq, {
      signal: new AbortController().signal,
    })
    expect(transcript).toEqual({
      language: 'zh',
      segments: [
        { startMs: 0, endMs: 3200, speakerId: '0', text: '我们开始今天的需求评审。' },
        { startMs: 3900, endMs: 6100, speakerId: '0', text: '好的,先看登录页。' },
      ],
    })
    const call = calls[0]!
    expect(call.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(call.headers.authorization).toBe('Bearer gsk-test')
    const form = call.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment'])
    expect(form.get('language')).toBe('zh')
    expect((form.get('file') as File).name).toBe('audio.webm')
  })

  it('omits the language for mixed / auto meetings', async () => {
    const calls = replay([[/transcriptions/, () => json(groqVerbose)]])
    for (const language of ['zh-en', 'auto']) {
      await openAiCompatibleTranscription.transcribe({ ...audio(), language }, groq, {
        signal: new AbortController().signal,
      })
    }
    expect(calls.map((c) => (c.body as FormData).get('language'))).toEqual([null, null])
  })

  it('uses json for gpt-4o-transcribe and falls back to one segment', async () => {
    const calls = replay([[/transcriptions/, () => json({ text: ' 大家好 ' })]])
    const transcript = await openAiCompatibleTranscription.transcribe(
      audio(),
      {
        ...groq,
        preset: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-transcribe',
      },
      { signal: new AbortController().signal },
    )
    expect((calls[0]!.body as FormData).get('response_format')).toBe('json')
    expect(transcript.segments).toEqual([
      { startMs: 0, endMs: 45_000, speakerId: '0', text: '大家好' },
    ])
  })

  it.each([
    null,
    {},
    { text: 1 },
    { text: 'ok', language: 3 },
    { text: 'ok', duration: -1 },
    { text: 'ok', duration: '1' },
    { text: 'ok', duration: null },
    { segments: [{ end: 1, text: 'x' }] },
    { segments: [{ start: '0', end: 1, text: 'x' }] },
    { segments: [{ start: -1, end: 1, text: 'x' }] },
    { segments: [{ start: 2, end: 1, text: 'x' }] },
    { segments: [{ start: 0, end: null, text: 'x' }] },
    { segments: [{ start: 0, end: 1, text: 5 }] },
    {
      segments: [
        { start: 2, end: 3, text: 'a' },
        { start: 1, end: 2, text: 'b' },
      ],
    },
  ])('rejects malformed responses: %j', async (body) => {
    replay([[/transcriptions/, () => json(body)]])
    await expect(
      openAiCompatibleTranscription.transcribe(audio(), groq, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'badResponse' })
  })

  it('rejects non-finite JSON numbers and non-finite fallback duration', async () => {
    replay([
      [/transcriptions/, () => new Response('{"segments":[{"start":0,"end":1e400,"text":"x"}]}')],
    ])
    await expect(
      openAiCompatibleTranscription.transcribe(audio(), groq, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'badResponse' })
    replay([[/transcriptions/, () => json({ text: 'ok' })]])
    await expect(
      openAiCompatibleTranscription.transcribe({ ...audio(), durationMs: NaN }, groq, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'badResponse' })
  })

  it('accepts zero-length, overlapping, empty and text-only compatible responses', async () => {
    for (const body of [
      {
        segments: [
          { start: 0, end: 0, text: 'a' },
          { start: 0, end: 2, text: 'b' },
          { start: 1, end: 3, text: 'c' },
        ],
      },
      { segments: [] },
      { text: '' },
      { text: 'hello', duration: 0.123 },
    ]) {
      replay([[/transcriptions/, () => json(body)]])
      await expect(
        openAiCompatibleTranscription.transcribe(audio(), groq, {
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({ segments: expect.any(Array) })
    }
  })

  it.each([
    [408, 'timeout'],
    [400, 'badRequest'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
  ])('maps HTTP %i to %s', async (status, code) => {
    replay([[/transcriptions/, () => json({ error: 'failure' }, status as number)]])
    await expect(
      openAiCompatibleTranscription.transcribe(audio(), groq, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code, status })
  })

  it('refuses files over the single-file limit (the pipeline splits them first)', async () => {
    const calls = replay([])
    const err = await openAiCompatibleTranscription
      .transcribe(audio(26 * 2 ** 20), groq, { signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'fileTooLarge' })
    expect(calls).toHaveLength(0)
  })

  it('maps 413 / 429 responses', async () => {
    replay([
      [
        /transcriptions/,
        () => json({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '2' }),
      ],
    ])
    await expect(
      openAiCompatibleTranscription.transcribe(audio(), groq, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'rateLimited',
      detail: 'Rate limit reached',
      retryAfterMs: 2000,
    })
  })
})

describe('openAiCompatibleLlm.generateObject', () => {
  const qwen = openAiCompatibleLlm.configSchema.parse({
    preset: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-qwen',
    model: 'qwen-plus',
  })
  const request = {
    system: generalSummaryTemplate.systemPrompt('zh-CN'),
    prompt: '[00:00|760] <0>: 我们开始今天的需求评审。',
    schema: generalSummaryTemplate.outputSchema,
  }

  it('asks for a JSON object and validates it against the template schema', async () => {
    const calls = replay([[/POST .*\/chat\/completions$/, () => json(chatSummary)]])
    const summary = await openAiCompatibleLlm.generateObject(request, qwen, {
      signal: new AbortController().signal,
    })
    expect(Summary.parse(summary)).toEqual(summary)
    expect(summary.actionItems).toEqual([{ text: '出登录页设计稿', due: '下周三' }])

    const call = calls[0]!
    expect(call.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer sk-qwen')
    const body = JSON.parse(String(call.body))
    expect(body).toMatchObject({ model: 'qwen-plus', response_format: { type: 'json_object' } })
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[0].content).toContain('JSON Schema')
    expect(body.messages[0].content).toContain('actionItems')
    expect(body.messages[1]).toMatchObject({ role: 'user', content: request.prompt })
  })

  it('reports output that does not match the schema as badResponse', async () => {
    replay([
      [
        /chat\/completions/,
        () =>
          json({
            ...chatSummary,
            choices: [
              {
                ...chatSummary.choices[0],
                message: { role: 'assistant', content: '{"overview":1}' },
              },
            ],
          }),
      ],
    ])
    await expect(
      openAiCompatibleLlm.generateObject(request, qwen, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'badResponse' })
  })

  it.each([
    [401, 'unauthorized'],
    [429, 'rateLimited'],
    [503, 'server'],
  ])('maps HTTP %i to %s without retrying inside the SDK', async (status, code) => {
    const calls = replay([
      [/chat\/completions/, () => json({ error: { message: 'nope' } }, status)],
    ])
    await expect(
      openAiCompatibleLlm.generateObject(request, qwen, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code, status })
    expect(calls).toHaveLength(1)
  })

  it('maps network failures and aborts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(
      openAiCompatibleLlm.generateObject(request, qwen, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'network' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      openAiCompatibleLlm.generateObject(request, qwen, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })
})
