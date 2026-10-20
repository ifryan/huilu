import { useTranslation } from '@huilu/i18n'
import { RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { useRecorderStatus } from '@/lib/recording'

/**
 * 采集标签页承载原生选择器选中的来源，选源后切回原网页，
 * 结束后自动关闭。打开此页时也能暂停 / 结束。
 */
export function RecorderWindow() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const active = status && status.state !== 'idle'

  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">{t('app.name')}</h1>
      <p className="text-sm">
        {active ? t('recorderWindow.recording') : t('recorderWindow.choosing')}
      </p>
      {active && <RecordingStatusCard status={status} />}
      <p className="text-muted-foreground text-xs">{t('recorderWindow.keepOpen')}</p>
    </main>
  )
}
