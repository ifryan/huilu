// 配置导入 / 导出（纯逻辑，不依赖 WXT）
import { describeConfigFields } from '@huilu/providers'
import { z } from 'zod'
import { getProvider, type ProviderKind, type ProviderSettings } from './providers'

const ProviderSettingsSchema = z.object({
  providerId: z.string(),
  configs: z.record(z.string(), z.record(z.string(), z.unknown())),
})

export const ConfigFile = z.object({
  app: z.literal('huilu'),
  kind: z.literal('settings'),
  version: z.literal(1),
  exportedAt: z.string(),
  transcription: ProviderSettingsSchema,
  llm: ProviderSettingsSchema,
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
 * 导入的配置没带密钥（导出时未勾选）时，保留本机已保存的密钥。
 */
export function mergeImported(
  current: TransferableSettings,
  file: ConfigFile,
): TransferableSettings {
  const merge = (kind: ProviderKind): ProviderSettings => {
    const configs = { ...current[kind].configs }
    for (const [id, imported] of Object.entries(file[kind].configs)) {
      const kept = Object.fromEntries(
        secretKeys(kind, id)
          .filter((k) => imported[k] === undefined && configs[id]?.[k] !== undefined)
          .map((k) => [k, configs[id]![k]]),
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
