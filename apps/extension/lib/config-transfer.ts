// 配置导入 / 导出（纯逻辑，不依赖 WXT）
import { describeConfigFields } from '@huilu/providers'
import { z } from 'zod'
import {
  getProvider,
  hasProvider,
  serviceOrigin,
  type ProviderKind,
  type ProviderSettings,
} from './providers'

/**
 * 服务商 ID 必须在对应的注册表里：getProvider 对未知 ID 会回退到默认服务商，
 * 拼错的 ID 会被按另一家的 schema 校验并显示为「已配置」（PR #6 审查 r4092377798）
 */
const providerSettingsSchema = (kind: ProviderKind) => {
  const known = (id: string) => hasProvider(kind, id)
  const message = (id: string) => `Unknown ${kind} provider: ${id}`
  return z.object({
    providerId: z.string().refine(known, { error: (issue) => message(String(issue.input)) }),
    configs: z.record(
      z.string().refine(known, { error: (issue) => message(String(issue.input)) }),
      z.record(z.string(), z.unknown()),
    ),
  })
}

export const ConfigFile = z.object({
  app: z.literal('huilu'),
  kind: z.literal('settings'),
  version: z.literal(1),
  exportedAt: z.string(),
  transcription: providerSettingsSchema('transcription'),
  llm: providerSettingsSchema('llm'),
})
export type ConfigFile = z.infer<typeof ConfigFile>

export interface TransferableSettings {
  transcription: ProviderSettings
  llm: ProviderSettings
}

const secretKeys = (kind: ProviderKind, providerId: string) =>
  describeConfigFields(getProvider(kind, providerId).configSchema)
    .filter((f) => f.secret)
    .map((f) => f.key)

function stripSecrets(kind: ProviderKind, settings: ProviderSettings): ProviderSettings {
  const configs = Object.fromEntries(
    Object.entries(settings.configs).map(([id, config]) => {
      const secrets = new Set(secretKeys(kind, id))
      return [id, Object.fromEntries(Object.entries(config).filter(([k]) => !secrets.has(k)))]
    }),
  )
  return { ...settings, configs }
}

export function buildConfigFile(
  settings: TransferableSettings,
  { includeSecrets }: { includeSecrets: boolean },
  now = new Date(),
): ConfigFile {
  const pick = (kind: ProviderKind) =>
    includeSecrets ? settings[kind] : stripSecrets(kind, settings[kind])
  return {
    app: 'huilu',
    kind: 'settings',
    version: 1,
    exportedAt: now.toISOString(),
    transcription: pick('transcription'),
    llm: pick('llm'),
  }
}

/**
 * 合并导入的配置：导入文件里没有的服务商保持不变；
 * 导入的配置没带密钥（导出时未勾选）时，只有服务地址的 origin 没变才保留本机已保存的密钥——
 * Key 属于原来的服务商，不能随导入被发给另一家（PR #6 审查 r4092377777，与表单的处理一致）。
 */
export function mergeImported(
  current: TransferableSettings,
  file: ConfigFile,
): TransferableSettings {
  const merge = (kind: ProviderKind): ProviderSettings => {
    const configs = { ...current[kind].configs }
    for (const [id, imported] of Object.entries(file[kind].configs)) {
      const local = configs[id]
      const origin = serviceOrigin(id, imported)
      const sameService =
        local !== undefined && origin !== undefined && origin === serviceOrigin(id, local)
      const kept = Object.fromEntries(
        secretKeys(kind, id)
          .filter((k) => sameService && imported[k] === undefined && local[k] !== undefined)
          .map((k) => [k, local![k]]),
      )
      configs[id] = { ...imported, ...kept }
    }
    return { providerId: file[kind].providerId, configs }
  }
  return { transcription: merge('transcription'), llm: merge('llm') }
}

export function parseConfigFile(text: string): ConfigFile {
  return ConfigFile.parse(JSON.parse(text))
}
