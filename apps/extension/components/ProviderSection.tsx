import type { TranscriptionProvider } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import { ProviderError, describeConfigFields, getPresets, type ConfigField } from '@huilu/providers'
import { Button } from '@huilu/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useDynamicT } from '@/lib/i18n'
import {
  applyPreset,
  connectionUrl,
  formatBytes,
  getProvider,
  initialFormValues,
  isConfigured,
  listProviders,
  parseForm,
  type FormValues,
  type ProviderKind,
  type ProviderSettings,
} from '@/lib/providers'
import { readinessKey } from '@/lib/readiness'
import { llmSetting, transcriptionSetting } from '@/lib/settings'
import { requestHostPermission } from '@/platform'
import { Section, StatusPill, inputClass } from './Section'

const settingItem = { transcription: transcriptionSetting, llm: llmSetting }

type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok' }
  | { state: 'failed'; message: string; detail?: string }

/** 转写 / 大模型服务配置：服务商选择 + 由 configSchema 生成的表单 + 测试连接 */
export function ProviderSection({
  kind,
  description,
  onSaved,
}: {
  kind: ProviderKind
  description?: string
  onSaved?: () => void
}) {
  const { data: settings, dataUpdatedAt } = useQuery({
    queryKey: ['providerSettings', kind],
    queryFn: () => settingItem[kind].getValue(),
    // 不自动刷新：刷新会重建表单，丢掉未保存的输入（例如切到别的标签页复制 Key 再回来）
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  if (!settings) return null
  // 配置被导入（resetQueries）后重新初始化表单
  return (
    <ProviderForm
      key={dataUpdatedAt}
      kind={kind}
      initialSettings={settings}
      description={description}
      onSaved={onSaved}
    />
  )
}

function ProviderForm({
  kind,
  initialSettings,
  description,
  onSaved,
}: {
  kind: ProviderKind
  initialSettings: ProviderSettings
  description?: string
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const dt = useDynamicT()
  const queryClient = useQueryClient()

  const [settings, setSettings] = useState(initialSettings)
  const [providerId, setProviderId] = useState(settings.providerId)
  const provider = getProvider(kind, providerId)
  const fields = useMemo(() => describeConfigFields(provider.configSchema), [provider])
  const [values, setValues] = useState<FormValues>(() =>
    initialFormValues(provider, settings.configs[provider.id]),
  )
  const [invalid, setInvalid] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<TestState>({ state: 'idle' })
  const abortRef = useRef<AbortController>(undefined)

  const reset = () => {
    abortRef.current?.abort()
    setInvalid([])
    setSaved(false)
    setTest({ state: 'idle' })
  }

  const selectProvider = (id: string) => {
    const next = getProvider(kind, id)
    setProviderId(next.id)
    setValues(initialFormValues(next, settings.configs[next.id]))
    setDirty(next.id !== settings.providerId)
    reset()
  }

  const setField = (field: ConfigField, value: string) => {
    setValues((v) =>
      field.key === 'preset' ? applyPreset(provider, v, value) : { ...v, [field.key]: value },
    )
    setDirty(true)
    reset()
  }

  const validate = () => {
    const result = parseForm(provider, values)
    setInvalid(result.ok ? [] : result.invalidKeys)
    return result
  }

  const invalidMessage =
    invalid.length > 0 &&
    t('settings.invalid', {
      fields: invalid
        .map((key) => dt(fields.find((f) => f.key === key)?.titleKey ?? key))
        .join(t('common.listSeparator')),
    })

  const save = async () => {
    const result = validate()
    if (!result.ok) return
    const current = await settingItem[kind].getValue()
    const next = {
      providerId: provider.id,
      configs: { ...current.configs, [provider.id]: result.config },
    }
    await settingItem[kind].setValue(next)
    setSettings(next)
    await queryClient.invalidateQueries({ queryKey: readinessKey })
    setDirty(false)
    setSaved(true)
    onSaved?.()
  }

  const testConnection = () => {
    const result = validate()
    if (!result.ok) return
    const url = connectionUrl(provider.id, result.config)
    // 先申请域名权限（需要用户激活，必须是点击后的第一个异步调用）
    const permitted = url ? requestHostPermission(url).catch(() => false) : Promise.resolve(true)
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setTest({ state: 'testing' })

    void permitted
      .then((ok) => {
        if (!ok) {
          throw new Error(t('settings.hostPermissionDenied', { origin: new URL(url!).origin }))
        }
        return provider.testConnection(result.config, { signal: controller.signal })
      })
      .then(
        () => !controller.signal.aborted && setTest({ state: 'ok' }),
        (e: unknown) => {
          if (controller.signal.aborted) return
          setTest(
            e instanceof ProviderError
              ? { state: 'failed', message: dt(`providers.error.${e.code}`), detail: e.detail }
              : {
                  state: 'failed',
                  message: e instanceof Error ? e.message : t('common.unknownError'),
                },
          )
        },
      )
  }

  const providers = listProviders(kind)
  const preset = getPresets(provider).find((p) => p.id === values.preset)
  const capabilities = kind === 'transcription' && (provider as TranscriptionProvider).capabilities
  const configured = !dirty && isConfigured(kind, { ...settings, providerId })

  return (
    <Section
      title={kind === 'transcription' ? t('settings.transcription') : t('settings.llm')}
      description={description}
      aside={
        <StatusPill ok={configured}>
          {dirty
            ? t('settings.unsaved')
            : configured
              ? t('settings.configured')
              : t('settings.notConfigured')}
        </StatusPill>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {providers.length > 1 && (
          <Field label={t('settings.provider')}>
            <select
              className={inputClass}
              value={provider.id}
              onChange={(e) => selectProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {dt(p.nameKey)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {fields.map((field) => (
          <Field key={field.key} label={dt(field.titleKey)} required={field.required}>
            <FieldInput
              field={field}
              value={values[field.key] ?? ''}
              invalid={invalid.includes(field.key)}
              onChange={(v) => setField(field, v)}
            />
            {field.key === 'preset' && preset?.hintKey && (
              <p className="text-muted-foreground mt-1 text-xs">{dt(preset.hintKey)}</p>
            )}
          </Field>
        ))}

        {capabilities && (
          <div className="bg-muted rounded-lg px-3 py-2 text-xs">
            <span className="font-medium">
              {t('settings.capabilities')}
              {t('common.colon')}
            </span>
            {capabilities.diarization ? t('settings.diarizationYes') : t('settings.diarizationNo')}
            {capabilities.maxFileBytes && (
              <>
                {t('common.clauseSeparator')}
                {t('settings.maxFile', { size: formatBytes(capabilities.maxFileBytes) })}
              </>
            )}
          </div>
        )}

        {invalidMessage && <p className="text-danger text-sm">{invalidMessage}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">{t('settings.save')}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={test.state === 'testing'}
            onClick={testConnection}
          >
            {test.state === 'testing' ? t('settings.testing') : t('settings.test')}
          </Button>
          {saved && <span className="text-sm text-emerald-600">{t('settings.saved')}</span>}
        </div>

        {test.state === 'ok' && (
          <p className="text-sm text-emerald-600" role="status">
            ✓ {t('settings.testOk')}
          </p>
        )}
        {test.state === 'failed' && (
          <div className="border-danger/40 bg-danger/10 rounded-lg px-3 py-2 text-sm" role="alert">
            <div className="font-medium">
              {t('settings.testFailed')}
              {t('common.colon')}
              {test.message}
            </div>
            {test.detail && (
              <div className="text-muted-foreground mt-1 font-mono text-xs break-all">
                {test.detail}
              </div>
            )}
          </div>
        )}
      </form>
    </Section>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span>
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

function FieldInput({
  field,
  value,
  invalid,
  onChange,
}: {
  field: ConfigField
  value: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const dt = useDynamicT()
  const [reveal, setReveal] = useState(false)

  if (field.kind === 'select') {
    return (
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {field.optionKeyPrefix ? dt(`${field.optionKeyPrefix}.${o}`) : o}
          </option>
        ))}
      </select>
    )
  }

  const input = (
    <input
      className={inputClass}
      aria-invalid={invalid || undefined}
      type={field.kind === 'secret' && !reveal ? 'password' : field.kind === 'url' ? 'url' : 'text'}
      autoComplete="off"
      spellCheck={false}
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  if (field.kind !== 'secret') return input
  return (
    <div className="flex gap-2">
      {input}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 self-center"
        onClick={() => setReveal((r) => !r)}
      >
        {reveal ? t('settings.hideKey') : t('settings.showKey')}
      </Button>
    </div>
  )
}
