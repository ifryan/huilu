import type {
  AudioInput,
  Transcript,
  TranscriptionContext,
  TranscriptionProvider,
} from '@huilu/core'
import { z } from 'zod'
import { ProviderError } from '../errors'
import { audioFileName, bearer, fetchJson, fetchText, sleep } from '../http'

export const DASHSCOPE_ENDPOINTS = {
  cn: 'https://dashscope.aliyuncs.com',
  intl: 'https://dashscope-intl.aliyuncs.com',
} as const

export const ParaformerConfig = z.object({
  region: z
    .enum(['cn', 'intl'])
    .default('cn')
    .meta({ titleKey: 'providers.field.region', optionKeyPrefix: 'providers.region' }),
  apiKey: z.string().trim().min(1).meta({ titleKey: 'providers.field.apiKey', secret: true }),
  model: z
    .string()
    .trim()
    .min(1)
    .default('paraformer-v2')
    .meta({ titleKey: 'providers.field.model' }),
})
export type ParaformerConfig = z.infer<typeof ParaformerConfig>

/**
 * 官方限制（2026-09 核对 help.aliyun.com「获取临时 URL」「Paraformer 录音文件识别 RESTful API」）：
 * - 临时文件 48 小时有效、与账号 + 模型绑定，不建议生产使用；上传凭证 300 秒过期；单文件 ≤ 1GB（以凭证中的 max_file_size_mb 为准）
 * - 识别结果（transcription_url）与任务信息保留 24 小时
 * 断点里的地址 / 任务号留出余量后才复用，过期就重新上传 / 提交
 */
export const PARAFORMER_LIMITS = {
  fileUrlTtlMs: 47 * 3600_000,
  taskTtlMs: 23 * 3600_000,
  pollIntervalMs: 3000,
  /** 单次识别最长等待时间，超过视为超时（可重试，重试时继续轮询同一个任务） */
  maxWaitMs: 3 * 3600_000,
  uploadTimeoutMs: 10 * 60_000,
}

/** 保存在处理任务里的断点：上传得到的 oss:// 地址、提交得到的任务号 */
export interface ParaformerCheckpoint {
  region: string
  model: string
  fileUrl?: string
  uploadedAt?: number
  taskId?: string
  submittedAt?: number
}

interface UploadPolicy {
  policy: string
  signature: string
  upload_dir: string
  upload_host: string
  oss_access_key_id: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
  max_file_size_mb?: number
}

interface TaskOutput {
  task_id?: string
  task_status?: string
  code?: string
  message?: string
  results?: {
    subtask_status?: string
    transcription_url?: string
    code?: string
    message?: string
  }[]
}

interface RecognitionResult {
  transcripts?: {
    sentences?: { begin_time: number; end_time: number; text: string; speaker_id?: number }[]
  }[]
}

/** 会议语言 → language_hints；自动识别时不传，由服务端判断 */
export function paraformerLanguageHints(language: string): string[] | undefined {
  if (language === 'en') return ['en']
  if (language === 'zh' || language === 'zh-en') return ['zh', 'en']
  const supported = ['zh', 'en', 'ja', 'yue', 'ko', 'de', 'fr', 'ru']
  return supported.includes(language) ? [language] : undefined
}

/** 百炼识别结果 → core 的 Transcript；speaker_id 从 0 开始 */
export function paraformerToTranscript(result: RecognitionResult, language: string): Transcript {
  const sentences = (result.transcripts ?? []).flatMap((t) => t.sentences ?? [])
  return {
    language,
    segments: sentences
      .filter((s) => typeof s.text === 'string' && s.text.trim() !== '')
      .map((s) => ({
        startMs: Math.max(0, Math.round(s.begin_time)),
        endMs: Math.max(0, Math.round(s.end_time)),
        speakerId: String(s.speaker_id ?? 0),
        text: s.text.trim(),
      }))
      .sort((a, b) => a.startMs - b.startMs),
  }
}

async function upload(
  input: AudioInput,
  { region, apiKey, model }: ParaformerConfig,
  ctx: TranscriptionContext,
): Promise<string> {
  const base = DASHSCOPE_ENDPOINTS[region]
  const { data: p } = await fetchJson<{ data?: UploadPolicy }>(
    `${base}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: bearer(apiKey) },
    ctx,
  )
  if (!p || typeof p.upload_host !== 'string' || typeof p.upload_dir !== 'string') {
    throw new ProviderError('badResponse', 'getPolicy')
  }
  if (p.max_file_size_mb && input.blob.size > p.max_file_size_mb * 2 ** 20) {
    throw new ProviderError(
      'fileTooLarge',
      `${(input.blob.size / 2 ** 20).toFixed(1)}MB > ${p.max_file_size_mb}MB`,
    )
  }
  const fileName = audioFileName(input.mimeType, `huilu-${Date.now()}`)
  const key = `${p.upload_dir}/${fileName}`
  const form = new FormData()
  form.append('OSSAccessKeyId', p.oss_access_key_id)
  form.append('Signature', p.signature)
  form.append('policy', p.policy)
  form.append('x-oss-object-acl', p.x_oss_object_acl)
  form.append('x-oss-forbid-overwrite', p.x_oss_forbid_overwrite)
  form.append('key', key)
  form.append('success_action_status', '200')
  // file 必须是最后一个字段
  form.append('file', input.blob, fileName)
  await fetchText(
    p.upload_host,
    { method: 'POST', body: form },
    ctx,
    PARAFORMER_LIMITS.uploadTimeoutMs,
  )
  return `oss://${key}`
}

async function submit(
  fileUrl: string,
  language: string,
  { region, apiKey, model }: ParaformerConfig,
  ctx: TranscriptionContext,
): Promise<string> {
  const hints = model === 'paraformer-v2' ? paraformerLanguageHints(language) : undefined
  const body = await fetchJson<{ output?: TaskOutput }>(
    `${DASHSCOPE_ENDPOINTS[region]}/api/v1/services/audio/asr/transcription`,
    {
      method: 'POST',
      headers: {
        ...bearer(apiKey),
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
        // 使用 oss:// 临时地址时必须带这个头
        'X-DashScope-OssResourceResolve': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { file_urls: [fileUrl] },
        parameters: {
          // 发言人区分只支持单声道：转写音频本身就是混音后的单轨
          diarization_enabled: true,
          ...(hints ? { language_hints: hints } : {}),
        },
      }),
    },
    ctx,
  )
  const taskId = body.output?.task_id
  if (typeof taskId !== 'string') throw new ProviderError('badResponse', 'submit: no task_id')
  return taskId
}

/** 轮询任务直到结束，返回识别结果 JSON。任务号已失效（查不到 / UNKNOWN）时返回 undefined，调用方重新提交 */
async function wait(
  taskId: string,
  { region, apiKey }: ParaformerConfig,
  ctx: TranscriptionContext,
): Promise<RecognitionResult | undefined> {
  const deadline = Date.now() + PARAFORMER_LIMITS.maxWaitMs
  for (;;) {
    let output: TaskOutput | undefined
    try {
      ;({ output } = await fetchJson<{ output?: TaskOutput }>(
        `${DASHSCOPE_ENDPOINTS[region]}/api/v1/tasks/${encodeURIComponent(taskId)}`,
        { headers: bearer(apiKey) },
        ctx,
      ))
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'notFound') return undefined
      throw e
    }
    const status = output?.task_status
    if (status === 'SUCCEEDED') {
      const failed = output?.results?.find((r) => r.subtask_status !== 'SUCCEEDED')
      if (failed) {
        throw new ProviderError(
          'taskFailed',
          [failed.code, failed.message].filter(Boolean).join(': '),
        )
      }
      const url = output?.results?.[0]?.transcription_url
      if (!url) throw new ProviderError('badResponse', 'no transcription_url')
      // 结果文件在 OSS 上，地址自带签名，不能带百炼的 Key
      return fetchJson<RecognitionResult>(url, {}, ctx, 60_000)
    }
    if (status === 'FAILED') {
      throw new ProviderError(
        'taskFailed',
        [output?.code, output?.message].filter(Boolean).join(': ') || undefined,
      )
    }
    if (status === 'UNKNOWN') return undefined
    if (status !== 'PENDING' && status !== 'RUNNING') {
      throw new ProviderError('badResponse', `task_status=${String(status)}`)
    }
    if (Date.now() > deadline) throw new ProviderError('timeout', `task ${taskId}`)
    await sleep(PARAFORMER_LIMITS.pollIntervalMs, ctx.signal)
  }
}

/**
 * 临时上传 → 提交异步识别（发言人区分）→ 轮询 → 下载结果。
 * 每完成一步就写断点：重试 / 重启后跳过已完成的上传和提交，避免重复上传与重复计费。
 */
async function transcribe(
  input: AudioInput,
  config: ParaformerConfig,
  ctx: TranscriptionContext,
): Promise<Transcript> {
  const now = () => Date.now()
  const saved = ctx.checkpoint?.get() as ParaformerCheckpoint | undefined
  // 换了地域 / 模型：临时文件与模型绑定，旧的地址和任务都不能用
  let cp: ParaformerCheckpoint =
    saved && saved.region === config.region && saved.model === config.model
      ? { ...saved }
      : { region: config.region, model: config.model }
  const save = async (next: ParaformerCheckpoint) => {
    cp = next
    await ctx.checkpoint?.set(next)
  }
  if (cp.fileUrl && now() - (cp.uploadedAt ?? 0) > PARAFORMER_LIMITS.fileUrlTtlMs) {
    await save({ region: cp.region, model: cp.model })
  }
  if (cp.taskId && now() - (cp.submittedAt ?? 0) > PARAFORMER_LIMITS.taskTtlMs) {
    await save({ ...cp, taskId: undefined, submittedAt: undefined })
  }

  // A terminally failed task cannot recover by polling it again. Keep the
  // uploaded file, but let an explicit retry submit a new task. Transient
  // polling failures retain the task ID to avoid duplicate submissions.
  const poll = async (taskId: string) => {
    try {
      return await wait(taskId, config, ctx)
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'taskFailed') {
        await save({ ...cp, taskId: undefined, submittedAt: undefined })
      }
      throw e
    }
  }

  ctx.onProgress?.(0)
  if (cp.taskId) {
    const result = await poll(cp.taskId)
    if (result) return paraformerToTranscript(result, input.language)
    // 任务已查不到：保留上传地址，重新提交
    await save({ ...cp, taskId: undefined, submittedAt: undefined })
  }
  if (!cp.fileUrl) {
    await save({ ...cp, fileUrl: await upload(input, config, ctx), uploadedAt: now() })
  }
  ctx.onProgress?.(0.3)
  const taskId = await submit(cp.fileUrl!, input.language, config, ctx)
  await save({ ...cp, taskId, submittedAt: now() })
  ctx.onProgress?.(0.4)
  const result = await poll(taskId)
  if (!result) throw new ProviderError('taskFailed', `task ${taskId} not found`)
  return paraformerToTranscript(result, input.language)
}

/** 阿里云百炼 Paraformer 录音文件识别（默认推荐，支持区分发言人） */
export const paraformer: TranscriptionProvider<ParaformerConfig> = {
  id: 'dashscope-paraformer',
  nameKey: 'providers.paraformer.name',
  configSchema: ParaformerConfig,
  capabilities: {
    diarization: true,
    languages: ['zh', 'en', 'ja', 'ko', 'yue'],
  },
  /**
   * 申请一次临时上传凭证（getPolicy）：不上传文件、不计费，
   * 能验证 Key、地域和模型名（凭证与模型绑定）。
   */
  async testConnection({ region, apiKey, model }, ctx) {
    const body = await fetchJson<{ data?: { upload_host?: unknown } }>(
      `${DASHSCOPE_ENDPOINTS[region]}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
      { headers: bearer(apiKey) },
      ctx,
    )
    if (typeof body.data?.upload_host !== 'string') {
      throw new ProviderError('badResponse', JSON.stringify(body).slice(0, 300))
    }
  },
  transcribe,
}
