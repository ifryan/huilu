import { browser } from '#imports'
import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { RecordingSetup } from '@/components/recording/RecordingSetup'
import { RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { UnfinishedRecordings } from '@/components/recording/UnfinishedRecordings'
import { sendMessage } from '@/lib/messaging'
import { useRecorderStatus } from '@/lib/recording'

export function Popup() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const busy = status !== undefined && status.state !== 'idle'

  // sidePanel.open 必须在点击的同步调用栈里调用，窗口 id 提前取好
  const [windowId, setWindowId] = useState<number>()
  useEffect(() => {
    void browser.windows.getCurrent().then((w) => setWindowId(w.id))
  }, [])
  const openSidePanel = () => {
    if (windowId !== undefined) void browser.sidePanel.open({ windowId })
  }

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('app.name')}</h1>
        <Button variant="outline" size="sm" onClick={() => void sendMessage('openApp', '/')}>
          {t('popup.openApp')}
        </Button>
      </header>

      {status && busy ? (
        <>
          <RecordingStatusCard status={status} />
          <Button variant="outline" onClick={openSidePanel}>
            {t('popup.openSidePanel')}
          </Button>
        </>
      ) : (
        <>
          <UnfinishedRecordings />
          <RecordingSetup />
        </>
      )}
    </main>
  )
}
