import { useTranslation } from '@huilu/i18n'
import { RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { useRecorderStatus } from '@/lib/recording'

export function RecorderWindow() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const active = status && status.state !== 'idle'

  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">{t('app.name')}</h1>
      {active ? (
        <RecordingStatusCard status={status} />
      ) : (
        <p className="text-muted-foreground text-sm">{t('recorderWindow.choosing')}</p>
      )}
      <p className="text-muted-foreground text-xs">{t('recorderWindow.keepOpen')}</p>
    </main>
  )
}
