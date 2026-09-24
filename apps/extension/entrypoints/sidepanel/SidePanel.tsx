import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import {
  LastRecordingNotice,
  RecordingStatusCard,
  StartErrorNotice,
} from '@/components/recording/RecordingStatusCard'
import { UnfinishedRecordings } from '@/components/recording/UnfinishedRecordings'
import { sendMessage } from '@/lib/messaging'
import { useRecorderStatus } from '@/lib/recording'

export function SidePanel() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const idle = !status || status.state === 'idle'

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('app.name')}</h1>
      {status && !idle && <RecordingStatusCard status={status} />}
      {status && idle && (
        <>
          {status.startError && <StartErrorNotice error={status.startError} />}
          {status.lastResult && <LastRecordingNotice result={status.lastResult} />}
          <div className="bg-muted flex flex-col gap-2 rounded-xl p-4 text-sm">
            <span className="font-medium">{t('sidepanel.idle')}</span>
            <span className="text-muted-foreground text-xs">{t('sidepanel.hint')}</span>
          </div>
          <UnfinishedRecordings />
          <Button variant="outline" onClick={() => void sendMessage('openApp', '/')}>
            {t('sidepanel.openHistory')}
          </Button>
        </>
      )}
    </main>
  )
}
