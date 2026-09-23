import { SUPPORTED_LOCALES, type Locale, useTranslation } from '@huilu/i18n'
import { localeSetting } from '@/lib/settings'

const LOCALE_LABELS: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English' }

export function SettingsPage() {
  const { t, i18n } = useTranslation()

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.settings')}</h1>

      <label className="flex items-center justify-between gap-4">
        <span>{t('settings.language')}</span>
        <select
          className="border-border bg-background rounded-lg border px-3 py-2"
          value={i18n.language}
          onChange={(e) => void localeSetting.setValue(e.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>

      {(['settings.dataFolder', 'settings.transcription', 'settings.llm'] as const).map((key) => (
        <div key={key} className="flex items-center justify-between">
          <span>{t(key)}</span>
          <span className="text-muted-foreground text-sm">{t('common.comingSoon')}</span>
        </div>
      ))}
    </section>
  )
}
