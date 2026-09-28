import { Registry, type LlmProvider, type TranscriptionProvider } from '@huilu/core'
import { resources } from '@huilu/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  builtinLlmProviders,
  builtinTranscriptionProviders,
  describeConfigFields,
  getPresets,
  openAiCompatibleLlm,
  openAiCompatibleTranscription,
  paraformer,
  registerBuiltinProviders,
} from './index'

const ctx = () => ({ signal: new AbortController().signal })

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const catchError = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as ProviderError,
  )

describe('paraformer.testConnection', () => {
  const config = paraformer.configSchema.parse({ apiKey: ' sk-test ' })

  it('requests an upload policy with the configured model and region', async () => {
    const fetch = mockFetch(200, { data: { upload_host: 'https://oss.example' } })
    await paraformer.testConnection({ ...config, region: 'intl' }, ctx())
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(
      'https://dashscope-intl.aliyuncs.com/api/v1/uploads?action=getPolicy&model=paraformer-v2',
    )
    expect(init?.headers).toEqual({ Authorization: 'Bearer sk-test' })
  })

  it('reports an invalid key as unauthorized with the provider message', async () => {
    mockFetch(401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.' })
    const err = await catchError(paraformer.testConnection(config, ctx()))
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({
      code: 'unauthorized',
      status: 401,
      detail: 'InvalidApiKey: Invalid API-key provided.',
    })
  })

  it('reports an unexpected body as badResponse', async () => {
    mockFetch(200, { data: {} })
    expect((await catchError(paraformer.testConnection(config, ctx())))?.code).toBe('badResponse')
  })

  it('requires an API key', () => {
    expect(paraformer.configSchema.safeParse({}).success).toBe(false)
  })
})

describe('OpenAI-compatible testConnection', () => {
  const llm = openAiCompatibleLlm.configSchema.parse({
    baseUrl: 'https://api.deepseek.com/v1/',
    apiKey: 'sk-x',
    model: 'deepseek-chat',
  })

  it('lists models and succeeds when the model exists', async () => {
    const fetch = mockFetch(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })
    await openAiCompatibleLlm.testConnection(llm, ctx())
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/models')
  })

  it('reports modelNotFound with the available models', async () => {
    mockFetch(200, { data: [{ id: 'a' }, { id: 'b' }] })
    const err = await catchError(openAiCompatibleLlm.testConnection(llm, ctx()))
    expect(err).toMatchObject({ code: 'modelNotFound', detail: 'a, b' })
  })

  it('sends no Authorization header when no key is set (Ollama)', async () => {
    const fetch = mockFetch(200, { data: [{ id: 'qwen2.5:7b' }] })
    await openAiCompatibleLlm.testConnection(
      { preset: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
      ctx(),
    )
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({})
  })

  it('extracts OpenAI-style error messages', async () => {
    mockFetch(401, { error: { message: 'Incorrect API key provided' } })
    const err = await catchError(
      openAiCompatibleTranscription.testConnection(
        { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'x', model: 'm' },
        ctx(),
      ),
    )
    expect(err).toMatchObject({ code: 'unauthorized', detail: 'Incorrect API key provided' })
  })

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
    [429, 'rateLimited'],
    [502, 'server'],
    [400, 'badRequest'],
  ])('maps HTTP %i to %s', async (status, code) => {
    mockFetch(status, 'oops')
    const err = await catchError(openAiCompatibleLlm.testConnection(llm, ctx()))
    expect(err).toMatchObject({ code, detail: 'oops' })
  })

  it('maps network failures (DNS, CORS, missing host permission) to network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await catchError(openAiCompatibleLlm.testConnection(llm, ctx()))
    expect(err).toMatchObject({ code: 'network', detail: 'Failed to fetch' })
  })

  it('maps a user abort to aborted', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        controller.abort()
        throw init.signal?.reason
      }),
    )
    const err = await catchError(
      openAiCompatibleLlm.testConnection(llm, { signal: controller.signal }),
    )
    expect(err?.code).toBe('aborted')
  })

  it('maps non-JSON success bodies to badResponse', async () => {
    mockFetch(200, '<html>login</html>')
    expect((await catchError(openAiCompatibleLlm.testConnection(llm, ctx())))?.code).toBe(
      'badResponse',
    )
  })

  it('rejects non-http base URLs', () => {
    const r = openAiCompatibleLlm.configSchema.safeParse({
      baseUrl: 'javascript:alert(1)',
      model: 'm',
    })
    expect(r.success).toBe(false)
  })
})

describe('describeConfigFields', () => {
  it('builds form fields from the config schema', () => {
    expect(describeConfigFields(paraformer.configSchema)).toEqual([
      expect.objectContaining({
        key: 'region',
        kind: 'select',
        options: ['cn', 'intl'],
        defaultValue: 'cn',
        required: false,
        optionKeyPrefix: 'providers.region',
      }),
      expect.objectContaining({ key: 'apiKey', kind: 'secret', required: true, secret: true }),
      expect.objectContaining({ key: 'model', kind: 'text', defaultValue: 'paraformer-v2' }),
    ])
    const llmFields = describeConfigFields(openAiCompatibleLlm.configSchema)
    expect(llmFields.find((f) => f.key === 'baseUrl')).toMatchObject({
      kind: 'url',
      required: true,
    })
    expect(llmFields.find((f) => f.key === 'apiKey')).toMatchObject({ required: false })
  })
})

describe('registry', () => {
  it('registers built-in providers idempotently', () => {
    const registries = {
      transcription: new Registry<TranscriptionProvider>('t'),
      llm: new Registry<LlmProvider>('l'),
    } as Parameters<typeof registerBuiltinProviders>[0]
    registerBuiltinProviders(registries)
    registerBuiltinProviders(registries)
    expect(registries.transcription.list().map((p) => p.id)).toEqual([
      'dashscope-paraformer',
      'openai-compatible',
    ])
    expect(registries.llm.list().map((p) => p.id)).toEqual(['openai-compatible'])
  })

  it('preset ids match the preset enum in the config schema', () => {
    for (const provider of [openAiCompatibleLlm, openAiCompatibleTranscription]) {
      const field = describeConfigFields(provider.configSchema).find((f) => f.key === 'preset')
      expect(getPresets(provider).map((p) => p.id)).toEqual(field?.options)
    }
    expect(getPresets(paraformer)).toEqual([])
  })
})

describe('i18n keys', () => {
  const lookup = (tree: unknown, key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree)

  const keys = new Set<string>()
  for (const provider of [...builtinTranscriptionProviders, ...builtinLlmProviders]) {
    keys.add(provider.nameKey)
    for (const preset of getPresets(provider)) {
      keys.add(preset.nameKey)
      if (preset.hintKey) keys.add(preset.hintKey)
    }
    for (const field of describeConfigFields(provider.configSchema)) {
      keys.add(field.titleKey)
      if (field.hintKey) keys.add(field.hintKey)
      for (const option of field.optionKeyPrefix ? (field.options ?? []) : []) {
        keys.add(`${field.optionKeyPrefix}.${option}`)
      }
    }
  }
  for (const code of PROVIDER_ERROR_CODES) keys.add(`providers.error.${code}`)

  it.each([...keys])('%s exists in every locale', (key) => {
    for (const locale of Object.values(resources)) {
      expect(typeof lookup(locale.translation, key)).toBe('string')
    }
  })
})
