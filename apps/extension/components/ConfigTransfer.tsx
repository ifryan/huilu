import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { buildConfigFile, mergeImported, parseConfigFile } from '@/lib/config-transfer'
import { llmSetting, transcriptionSetting } from '@/lib/settings'
import { Section } from './Section'

/** 导入 / 导出服务商配置（JSON 文件）；默认不包含 API Key */
export function ConfigTransfer() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()

  const exportConfig = async () => {
    const file = buildConfigFile(
      { transcription: await transcriptionSetting.getValue(), llm: await llmSetting.getValue() },
      { includeSecrets },
    )
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `huilu-settings-${file.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importConfig = async (file: File) => {
    try {
      const parsed = parseConfigFile(await file.text())
      const merged = mergeImported(
        { transcription: await transcriptionSetting.getValue(), llm: await llmSetting.getValue() },
        parsed,
      )
      await transcriptionSetting.setValue(merged.transcription)
      await llmSetting.setValue(merged.llm)
      // 让表单按新配置重新初始化
      await queryClient.resetQueries()
      setMessage({ ok: true, text: t('settings.transfer.imported') })
    } catch (e) {
      const reason = e instanceof Error ? e.message.slice(0, 200) : String(e)
      setMessage({ ok: false, text: t('settings.transfer.importFailed', { reason }) })
    }
  }

  return (
    <Section title={t('settings.transfer.title')}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeSecrets}
          onChange={(e) => setIncludeSecrets(e.target.checked)}
        />
        {t('settings.transfer.includeKeys')}
      </label>
      {includeSecrets && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('settings.transfer.keysWarning')}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => void exportConfig()}>
          {t('settings.transfer.export')}
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          {t('settings.transfer.import')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importConfig(file)
          }}
        />
      </div>
      {message && (
        <p className={message.ok ? 'text-sm text-emerald-600' : 'text-danger text-sm'}>
          {message.text}
        </p>
      )}
    </Section>
  )
}
