import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { RecordingHome } from '@/components/recording/RecordingHome'
import { RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { sendMessage } from '@/lib/messaging'
import { useRecorderStatus } from '@/lib/recording'

/**
 * 工具栏弹窗：只在放不进网页面板的页面（chrome://、应用商店、新标签页、非 HTTPS 网页）上由后台打开。
 * 这些页面不能开始录制：提示切换到普通网页，开始按钮禁用；录制中仍可在这里暂停 / 结束
 */
export function Popup() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const busy = status !== undefined && status.state !== 'idle'

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-headline font-semibold">{t('app.name')}</h1>
        <Button variant="outline" size="sm" onClick={() => void sendMessage('openApp', '/')}>
          {t('popup.openApp')}
        </Button>
      </header>

      <p role="status" className="bg-warning-soft text-body2 rounded-control px-3 py-2">
        {busy ? t('popup.pageUnsupportedRecording') : t('popup.pageUnsupported')}
      </p>

      {status && busy ? (
        <RecordingStatusCard status={status} />
      ) : (
        <RecordingHome status={status} disabled onStart={() => Promise.resolve()} />
      )}
    </main>
  )
}
