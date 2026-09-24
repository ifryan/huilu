import { describe, expect, it } from 'vitest'
import { buildConfigFile, mergeImported, parseConfigFile } from './config-transfer'
import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_TRANSCRIPTION_SETTINGS,
  applyPreset,
  connectionUrl,
  formatBytes,
  getProvider,
  initialFormValues,
  isConfigured,
  maskSecret,
  parseForm,
  updateField,
} from './providers'

const llm = getProvider('llm', 'openai-compatible')
const paraformer = getProvider('transcription', 'dashscope-paraformer')

describe('provider forms', () => {
  it('prefills the default preset for a new provider', () => {
    expect(initialFormValues(llm)).toEqual({
      preset: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      model: 'qwen-plus',
    })
    expect(initialFormValues(paraformer)).toEqual({
      region: 'cn',
      apiKey: '',
      model: 'paraformer-v2',
    })
  })

  it('uses saved values instead of presets', () => {
    const saved = { preset: 'custom', baseUrl: 'https://x.test/v1', model: 'm' }
    expect(initialFormValues(llm, saved)).toMatchObject({ ...saved, apiKey: '' })
  })

  it('applies a preset and clears the key when the host changes', () => {
    const qwen = { ...initialFormValues(llm), apiKey: 'sk-qwen' }
    const values = applyPreset(llm, qwen, 'ollama')
    expect(values).toMatchObject({
      preset: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
    })
    // 「自定义」不带地址：仍指向同一个 origin，保留已填的 Key
    const custom = applyPreset(llm, { ...values, apiKey: 'local' }, 'custom')
    expect(custom).toMatchObject({ baseUrl: 'http://localhost:11434/v1', apiKey: 'local' })
  })

  it('never carries a key over to another provider host', () => {
    const qwen = { ...initialFormValues(llm), apiKey: 'sk-qwen' }
    expect(applyPreset(llm, qwen, 'deepseek').apiKey).toBe('')
    expect(applyPreset(llm, qwen, 'openai').apiKey).toBe('')
    const transcription = getProvider('transcription', 'openai-compatible')
    const groq = { ...initialFormValues(transcription), apiKey: 'gsk-1' }
    expect(applyPreset(transcription, groq, 'openai').apiKey).toBe('')
    // 手改 Base URL 到别的域名同样清空；同一域名下改路径保留
    expect(updateField(llm, qwen, 'baseUrl', 'https://evil.example/v1').apiKey).toBe('')
    expect(
      updateField(llm, qwen, 'baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v2').apiKey,
    ).toBe('sk-qwen')
    // Paraformer 切地域也会换域名
    const cn = { region: 'cn', apiKey: 'sk-cn', model: 'paraformer-v2' }
    expect(updateField(paraformer, cn, 'region', 'intl').apiKey).toBe('')
    expect(updateField(paraformer, cn, 'model', 'paraformer-v1').apiKey).toBe('sk-cn')
  })

  it('requires a key for authenticated presets only', () => {
    const blank = (preset: string) =>
      parseForm(llm, { ...applyPreset(llm, initialFormValues(llm), preset), apiKey: '' })
    for (const preset of ['qwen', 'deepseek', 'openai']) {
      expect(blank(preset)).toEqual({ ok: false, invalidKeys: ['apiKey'] })
    }
    expect(blank('ollama').ok).toBe(true)
    expect(
      parseForm(llm, {
        preset: 'custom',
        baseUrl: 'http://10.0.0.2:8000/v1',
        apiKey: '',
        model: 'm',
      }).ok,
    ).toBe(true)
    const transcription = getProvider('transcription', 'openai-compatible')
    const groq = { ...initialFormValues(transcription), apiKey: '' }
    expect(parseForm(transcription, groq)).toEqual({ ok: false, invalidKeys: ['apiKey'] })
    // 已保存的旧配置（空 Key 的内置预设）也不再算已配置
    const settings = {
      providerId: 'openai-compatible',
      configs: {
        'openai-compatible': {
          preset: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
        },
      },
    }
    expect(isConfigured('llm', settings)).toBe(false)
  })

  it('reports invalid fields and treats blanks as missing', () => {
    expect(parseForm(paraformer, { region: 'cn', apiKey: '  ', model: '' })).toEqual({
      ok: false,
      invalidKeys: ['apiKey'],
    })
    const r = parseForm(paraformer, { region: 'cn', apiKey: ' sk-1 ', model: '' })
    expect(r).toEqual({
      ok: true,
      config: { region: 'cn', apiKey: 'sk-1', model: 'paraformer-v2' },
    })
  })

  it('defaults point at registered providers', () => {
    expect(getProvider('transcription', DEFAULT_TRANSCRIPTION_SETTINGS.providerId).id).toBe(
      DEFAULT_TRANSCRIPTION_SETTINGS.providerId,
    )
    expect(getProvider('llm', DEFAULT_LLM_SETTINGS.providerId).id).toBe(
      DEFAULT_LLM_SETTINGS.providerId,
    )
  })

  it('is configured only after a valid config is saved', () => {
    expect(isConfigured('transcription', DEFAULT_TRANSCRIPTION_SETTINGS)).toBe(false)
    expect(
      isConfigured('transcription', {
        providerId: 'dashscope-paraformer',
        configs: { 'dashscope-paraformer': { apiKey: 'sk-1' } },
      }),
    ).toBe(true)
    expect(
      isConfigured('transcription', {
        providerId: 'openai-compatible',
        configs: { 'dashscope-paraformer': { apiKey: 'sk-1' } },
      }),
    ).toBe(false)
  })

  it('finds the URL to request host permission for', () => {
    expect(connectionUrl('openai-compatible', { baseUrl: 'https://x.test/v1' })).toBe(
      'https://x.test/v1',
    )
    expect(connectionUrl('dashscope-paraformer', { region: 'intl' })).toBe(
      'https://dashscope-intl.aliyuncs.com',
    )
  })

  it('masks secrets and formats sizes', () => {
    expect(maskSecret('sk-abcdef123456')).toBe('sk-a••••3456')
    expect(maskSecret('short')).toBe('•••••')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB')
  })
})

describe('config import / export', () => {
  const settings = {
    transcription: {
      providerId: 'dashscope-paraformer',
      configs: { 'dashscope-paraformer': { region: 'cn', apiKey: 'sk-t', model: 'paraformer-v2' } },
    },
    llm: {
      providerId: 'openai-compatible',
      configs: {
        'openai-compatible': {
          preset: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-l',
          model: 'deepseek-chat',
        },
      },
    },
  }

  it('strips API keys unless asked to include them', () => {
    const without = buildConfigFile(settings, { includeSecrets: false })
    expect(without.transcription.configs['dashscope-paraformer']).toEqual({
      region: 'cn',
      model: 'paraformer-v2',
    })
    expect(without.llm.configs['openai-compatible']).not.toHaveProperty('apiKey')
    const withKeys = buildConfigFile(settings, { includeSecrets: true })
    expect(withKeys.llm.configs['openai-compatible']?.apiKey).toBe('sk-l')
  })

  it('round-trips through JSON', () => {
    const file = buildConfigFile(
      settings,
      { includeSecrets: true },
      new Date('2026-09-24T00:00:00Z'),
    )
    expect(parseConfigFile(JSON.stringify(file))).toEqual(file)
  })

  it('rejects files that are not HuiLu settings', () => {
    expect(() => parseConfigFile('{"app":"other"}')).toThrow()
    expect(() => parseConfigFile('not json')).toThrow()
  })

  it('keeps local keys when importing a file without keys', () => {
    const file = buildConfigFile(
      {
        ...settings,
        llm: {
          providerId: 'openai-compatible',
          configs: {
            'openai-compatible': {
              preset: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
            },
          },
        },
      },
      { includeSecrets: false },
    )
    const merged = mergeImported(settings, file)
    expect(merged.llm.configs['openai-compatible']).toEqual({
      preset: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-l',
    })
  })

  it('imports keys when present and switches the selected provider', () => {
    const file = buildConfigFile(
      {
        transcription: {
          providerId: 'openai-compatible',
          configs: {
            'openai-compatible': {
              preset: 'groq',
              baseUrl: 'https://api.groq.com/openai/v1',
              apiKey: 'gsk',
              model: 'whisper-large-v3-turbo',
            },
          },
        },
        llm: DEFAULT_LLM_SETTINGS,
      },
      { includeSecrets: true },
    )
    const merged = mergeImported(settings, file)
    expect(merged.transcription.providerId).toBe('openai-compatible')
    expect(merged.transcription.configs['openai-compatible']?.apiKey).toBe('gsk')
    // 导入文件里没有的服务商保持不变
    expect(merged.transcription.configs['dashscope-paraformer']?.apiKey).toBe('sk-t')
  })
})
