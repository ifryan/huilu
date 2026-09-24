import { browser } from '#imports'
import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { RecordingSetup } from '@/components/recording/RecordingSetup'
import { RecordingBrief, RecordingStatusCard } from '@/components/recording/RecordingStatusCard'
import { UnfinishedRecordings } from '@/components/recording/UnfinishedRecordings'
import { sendMessage } from '@/lib/messaging'
import { useReadiness } from '@/lib/readiness'
import { useRecorderStatus } from '@/lib/recording'

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
  // 当前页面不允许显示悬浮面板（如 chrome:// 页面）时，退回在弹窗里控制
  const [panelUnavailable, setPanelUnavailable] = useState(false)
  const showPanel = async () => {
    if (tabId === undefined) return setPanelUnavailable(true)
    const shown = await sendMessage('showRecordingPanel', tabId)
    if (shown) window.close()
    else setPanelUnavailable(true)
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
        panelUnavailable ? (
          <>
            <p className="text-muted-foreground text-xs">{t('popup.panelUnavailable')}</p>
            <RecordingStatusCard status={status} />
          </>
        ) : (
          <>
            {/* 录制中只给简短状态：计时、暂停 / 继续、结束统一在页面内悬浮面板，关掉后从这里找回 */}
            <RecordingBrief status={status} />
            <Button onClick={() => void showPanel()}>{t('popup.showPanel')}</Button>
          </>
        )
      ) : (
        <>
          <ReadinessStatus />
          <UnfinishedRecordings />
          <RecordingSetup onStarted={(shown) => setPanelUnavailable(!shown)} />
        </>
      )}
    </main>
  )
}

/**
 * 就绪状态：文件夹是否授权、API 是否配置，未就绪时一键跳转到插件网页处理。
 * 重新授权放在插件网页里完成：弹窗失去焦点会被关闭，不适合承载授权弹窗。
 * 未就绪不影响录制（录制只依赖 OPFS）。
 */
function ReadinessStatus() {
  const { t } = useTranslation()
  const { data } = useReadiness()
  if (!data) return null

  const items: { key: string; text: string; action: string; route: string }[] = []
  if (!data.onboarded) {
    items.push({
      key: 'onboarding',
      text: t('readiness.onboarding'),
      action: t('popup.goSetup'),
      route: '/onboarding',
    })
  } else {
    const { permission } = data.folder
    if (permission !== 'granted') {
      items.push({
        key: 'folder',
        text:
          permission === 'prompt'
            ? t('readiness.folderPrompt')
            : permission === 'denied'
              ? t('readiness.folderDenied')
              : t('readiness.folderUnset'),
        action: permission === 'prompt' ? t('popup.reauthorize') : t('popup.goSetup'),
        route: '/settings',
      })
    }
    if (!data.transcription || !data.llm) {
      items.push({
        key: 'api',
        text: t('readiness.apiMissing'),
        action: t('popup.goSetup'),
        route: '/settings',
      })
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        ✓ {t('readiness.ready')}
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs"
        >
          <span>{item.text}</span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => void sendMessage('openApp', item.route)}
          >
            {item.action}
          </Button>
        </li>
      ))}
    </ul>
  )
}
