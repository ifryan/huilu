import { SUPPORTED_LOCALES, type Locale, useTranslation } from '@huilu/i18n'
import { ConfigTransfer } from '@/components/ConfigTransfer'
import { DataFolderSection } from '@/components/DataFolderSection'
import { ProviderComparison } from '@/components/ProviderComparison'
import { ProviderSection } from '@/components/ProviderSection'
import { Section, inputClass } from '@/components/Section'
import { localeSetting } from '@/lib/settings'

const LOCALE_LABELS: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English' }

export function SettingsPage() {
  const { t, i18n } = useTranslation()

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.settings')}</h1>

      <DataFolderSection />

      <div className="flex flex-col gap-3">
        <ProviderSection kind="transcription" />
        <ProviderComparison />
      </div>

      <ProviderSection kind="llm" />

      <Section title={t('settings.language')}>
        <select
          className={inputClass}
          value={i18n.language}
          onChange={(e) => void localeSetting.setValue(e.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </Section>

      <ConfigTransfer />
    </section>
  )
}
