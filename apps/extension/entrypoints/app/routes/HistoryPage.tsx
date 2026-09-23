import { useTranslation } from '@huilu/i18n'

export function HistoryPage() {
  const { t } = useTranslation()
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">{t('nav.history')}</h1>
      <p className="text-muted-foreground">{t('history.empty')}</p>
    </section>
  )
}
