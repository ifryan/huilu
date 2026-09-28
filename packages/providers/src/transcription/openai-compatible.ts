import type { AudioInput, Transcript, TaskContext, TranscriptionProvider } from '@huilu/core'
import { z } from 'zod'
import { httpUrl, requireKeyForPresets } from '../config-fields'
import { ProviderError } from '../errors'
import { audioFileName, bearer, fetchJson, trimBaseUrl } from '../http'
import { testOpenAiCompatible } from '../openai-compatible'
import type { WithPresets } from '../presets'

export const OpenAiCompatibleTranscriptionConfig = z
  .object({
    preset: z
      .enum(['groq', 'openai', 'custom'])
      .default('groq')
      .meta({ titleKey: 'providers.field.preset', optionKeyPrefix: 'providers.preset' }),
    baseUrl: httpUrl().meta({
      titleKey: 'providers.field.baseUrl',
      placeholder: 'https://api.groq.com/openai/v1',
    }),
    // 自定义地址可以不填；Groq / OpenAI 必须填
    apiKey: z.string().trim().optional().meta({ titleKey: 'providers.field.apiKey', secret: true }),
    model: z.string().trim().min(1).meta({ titleKey: 'providers.field.model' }),
  })
  .superRefine(requireKeyForPresets(['groq', 'openai']))
export type OpenAiCompatibleTranscriptionConfig = z.infer<
  typeof OpenAiCompatibleTranscriptionConfig
>

/** 单次上传的超时：25MB 的音频在慢速代理下也要能传完 */
const TRANSCRIBE_TIMEOUT_MS = 10 * 60_000

interface VerboseTranscription {
  text?: string
  language?: string
  duration?: number
  segments?: { start: number; end: number; text: string }[]
}

/** Whisper 的 language 参数只接受单个 ISO-639-1 代码；中英混合、自动识别时不传 */
export function whisperLanguage(language: string): string | undefined {
  return /^[a-z]{2}$/.test(language) ? language : undefined
}

/**
 * gpt-4o-transcribe 系列只支持 json / text（没有分段时间戳），whisper 系列支持 verbose_json。
 * 取不到分段时整段作为一句，时间轴覆盖整个文件
 */
function responseFormat(model: string): 'verbose_json' | 'json' {
  return /^gpt-4o/i.test(model) ? 'json' : 'verbose_json'
}

/** 语言名（Whisper verbose_json 返回 'chinese' / 'english'）→ 代码 */
function normalizeLanguage(detected: string | undefined, fallback: string): string {
  const map: Record<string, string> = { chinese: 'zh', english: 'en', japanese: 'ja', korean: 'ko' }
  if (!detected) return fallback
  const lower = detected.toLowerCase()
  return map[lower] ?? (/^[a-z]{2}$/.test(lower) ? lower : fallback)
}

/** 超过单文件上限时由处理管线先切片；这里只处理一个不超限的文件。不区分发言人，speakerId 统一为 '0' */
async function transcribe(
  input: AudioInput,
  config: OpenAiCompatibleTranscriptionConfig,
  ctx: TaskContext,
): Promise<Transcript> {
  const max = openAiCompatibleTranscription.capabilities.maxFileBytes
  if (max && input.blob.size > max) {
    throw new ProviderError('fileTooLarge', `${input.blob.size} > ${max}`)
  }
  const format = responseFormat(config.model)
  const form = new FormData()
  form.append('file', input.blob, audioFileName(input.mimeType))
  form.append('model', config.model)
  form.append('response_format', format)
  if (format === 'verbose_json') form.append('timestamp_granularities[]', 'segment')
  const language = whisperLanguage(input.language)
  if (language) form.append('language', language)
  ctx.onProgress?.(0)
  const body = await fetchJson<VerboseTranscription>(
    `${trimBaseUrl(config.baseUrl)}/audio/transcriptions`,
    { method: 'POST', headers: bearer(config.apiKey), body: form },
    ctx,
    TRANSCRIBE_TIMEOUT_MS,
  )
  ctx.onProgress?.(1)
  const lang = normalizeLanguage(body.language, language ?? input.language)
  if (Array.isArray(body.segments)) {
    return {
      language: lang,
      segments: body.segments
        .filter((s) => typeof s.text === 'string' && s.text.trim() !== '')
        .map((s) => ({
          startMs: Math.max(0, Math.round(s.start * 1000)),
          endMs: Math.max(0, Math.round(s.end * 1000)),
          speakerId: '0',
          text: s.text.trim(),
        })),
    }
  }
  if (typeof body.text !== 'string') throw new ProviderError('badResponse', 'no text')
  const text = body.text.trim()
  const endMs = Math.round((body.duration ?? input.durationMs / 1000) * 1000)
  return {
    language: lang,
    segments: text ? [{ startMs: 0, endMs: Math.max(0, endMs), speakerId: '0', text }] : [],
  }
}

/** OpenAI 兼容转写接口（/audio/transcriptions），内置 Groq / OpenAI 预设 */
export const openAiCompatibleTranscription: TranscriptionProvider<OpenAiCompatibleTranscriptionConfig> &
  WithPresets = {
  id: 'openai-compatible',
  nameKey: 'providers.openaiCompatibleTranscription.name',
  configSchema: OpenAiCompatibleTranscriptionConfig,
  capabilities: {
    diarization: false,
    maxFileBytes: 25 * 2 ** 20,
    languages: ['zh', 'en'],
  },
  presets: [
    {
      id: 'groq',
      nameKey: 'providers.preset.groq',
      values: { baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
    },
    {
      id: 'openai',
      nameKey: 'providers.preset.openai',
      values: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
    },
    { id: 'custom', nameKey: 'providers.preset.custom', values: {} },
  ],
  testConnection: (config, ctx) => testOpenAiCompatible(config, ctx),
  transcribe,
}
