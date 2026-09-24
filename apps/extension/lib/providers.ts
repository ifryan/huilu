// 服务商相关的纯逻辑（不依赖 WXT），便于单元测试
import { registries, type LlmProvider, type TranscriptionProvider } from '@huilu/core'
import {
  DASHSCOPE_ENDPOINTS,
  describeConfigFields,
  getPresets,
  paraformer,
  registerBuiltinProviders,
} from '@huilu/providers'
import type { ProviderSettings } from './provider-settings'

registerBuiltinProviders(registries)

export * from './provider-settings'

export type ProviderKind = 'transcription' | 'llm'
export type ProviderConfig = Record<string, unknown>
/** 表单中的原始输入，全部为字符串 */
export type FormValues = Record<string, string>

export function listProviders(kind: ProviderKind): (TranscriptionProvider | LlmProvider)[] {
  return kind === 'transcription' ? registries.transcription.list() : registries.llm.list()
}

export function getProvider(kind: ProviderKind, id: string) {
  const registry = kind === 'transcription' ? registries.transcription : registries.llm
  return registry.has(id) ? registry.get(id) : listProviders(kind)[0]!
}

/** 当前选择的服务商已保存且配置有效 */
export function isConfigured(kind: ProviderKind, settings: ProviderSettings): boolean {
  const saved = settings.configs[settings.providerId]
  return (
    saved !== undefined &&
    getProvider(kind, settings.providerId).configSchema.safeParse(saved).success
  )
}

/** 表单初始值：已保存的配置，否则为 schema 默认值 + 默认预设 */
export function initialFormValues(
  provider: TranscriptionProvider | LlmProvider,
  saved?: ProviderConfig,
): FormValues {
  const values: FormValues = {}
  for (const field of describeConfigFields(provider.configSchema)) {
    const v = saved?.[field.key]
    values[field.key] = typeof v === 'string' ? v : (field.defaultValue ?? '')
  }
  if (!saved) {
    const preset = getPresets(provider).find((p) => p.id === values.preset)
    Object.assign(values, preset?.values)
  }
  return values
}

/** 切换预设：填入预设的 Base URL / 模型，保留已填的 Key */
export function applyPreset(
  provider: TranscriptionProvider | LlmProvider,
  values: FormValues,
  presetId: string,
): FormValues {
  const preset = getPresets(provider).find((p) => p.id === presetId)
  return { ...values, preset: presetId, ...preset?.values }
}

export type ParseResult =
  { ok: true; config: ProviderConfig } | { ok: false; invalidKeys: string[] }

/** 用 configSchema 校验表单；空字符串视为未填 */
export function parseForm(
  provider: TranscriptionProvider | LlmProvider,
  values: FormValues,
): ParseResult {
  const input = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v.trim() === '' ? undefined : v]),
  )
  const result = provider.configSchema.safeParse(input)
  if (result.success) return { ok: true, config: result.data as ProviderConfig }
  const invalidKeys = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? '')))]
  return { ok: false, invalidKeys }
}

/** 测试连接时需要访问的地址，用于申请域名权限 */
export function connectionUrl(providerId: string, config: ProviderConfig): string | undefined {
  if (typeof config.baseUrl === 'string') return config.baseUrl
  if (providerId === paraformer.id) {
    return DASHSCOPE_ENDPOINTS[(config.region as keyof typeof DASHSCOPE_ENDPOINTS) ?? 'cn']
  }
  return undefined
}

/** 打码显示密钥：sk-abcdef123456 → sk-a••••3456 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '•'.repeat(secret.length)
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}
