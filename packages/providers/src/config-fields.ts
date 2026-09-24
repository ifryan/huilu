import { z } from 'zod'

/**
 * 配置字段的界面元数据，写在 configSchema 的 .meta() 里，设置页据此自动生成表单：
 *   apiKey: z.string().meta({ titleKey: 'providers.field.apiKey', secret: true })
 */
export interface FieldMeta {
  /** 字段名称的 i18n key */
  titleKey: string
  /** 字段说明的 i18n key */
  hintKey?: string
  /** 密钥类字段：界面打码显示，导出配置时可排除 */
  secret?: boolean
  placeholder?: string
  /** 枚举选项名称的 i18n key 前缀：`${optionKeyPrefix}.${value}` */
  optionKeyPrefix?: string
}

export interface ConfigField extends FieldMeta {
  key: string
  kind: 'text' | 'url' | 'secret' | 'select'
  required: boolean
  options?: string[]
  defaultValue?: string
}

interface JsonSchemaProp extends Partial<FieldMeta> {
  type?: string
  format?: string
  enum?: string[]
  default?: unknown
}

/** 把 z.object 配置 schema 转成表单字段列表（只支持字符串与枚举字段，服务商配置足够用） */
export function describeConfigFields(schema: z.ZodType): ConfigField[] {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, JsonSchemaProp>
    required?: string[]
  }
  const required = new Set(json.required ?? [])
  return Object.entries(json.properties ?? {}).map(([key, p]) => ({
    key,
    titleKey: p.titleKey ?? key,
    hintKey: p.hintKey,
    secret: p.secret,
    placeholder: p.placeholder,
    optionKeyPrefix: p.optionKeyPrefix,
    kind: p.enum ? 'select' : p.secret ? 'secret' : p.format === 'uri' ? 'url' : 'text',
    // 有默认值的字段在界面上不算必填
    required: required.has(key) && p.default === undefined,
    options: p.enum,
    defaultValue: typeof p.default === 'string' ? p.default : undefined,
  }))
}

/** 用户输入的 http(s) 地址；z.url() 默认也接受 javascript: 等协议，这里收窄 */
export const httpUrl = () => z.url({ protocol: /^https?$/ })
