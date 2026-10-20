import { browser } from '#imports'
import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { RecordingHome } from '@/components/recording/RecordingHome'
import { RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { sendMessage } from '@/lib/messaging'
import { useRecorderStatus } from '@/lib/recording'

/**
 * 工具栏弹窗：只在网页面板放不进去的页面（chrome://、应用商店、新标签页、非 HTTPS 网页）上由后台打开，
 * 内容与网页面板相同；录制中直接在这里控制
 */
export function Popup() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const busy = status !== undefined && status.state !== 'idle'

  const [tabId, setTabId] = useState<number>()
  useEffect(() => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => setTabId(active?.id))
  }, [])

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-headline font-semibold">{t('app.name')}</h1>
        <Button variant="outline" size="sm" onClick={() => void sendMessage('openApp', '/')}>
          {t('popup.openApp')}
        </Button>
      </header>

      {status && busy ? (
        <>
          <p className="text-muted-foreground text-body2">{t('popup.panelUnavailable')}</p>
          <RecordingStatusCard status={status} />
        </>
      ) : (
        <RecordingHome
          status={status}
          disabled={tabId === undefined}
          onStart={async (request) => {
            // 这里的页面放不进网页面板：统一来源选择由后台退回采集标签页
            const { panelShown } = await sendMessage('startRecording', { ...request, tabId })
            // 面板显示得了（如选源后切回了普通网页）就交给面板，否则留在弹窗里控制
            if (panelShown) window.close()
          }}
        />
      )}
    </main>
  )
}
