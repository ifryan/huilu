import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { sendMessage, type RecorderStatus, type StartRecordingRequest } from '@/lib/messaging'
import { useReadiness } from '@/lib/readiness'
import { RecordingSetup } from './RecordingSetup'
import { LastRecordingNotice, StartErrorNotice } from './RecordingStatusCard'
import { UnfinishedRecordings } from './UnfinishedRecordings'

/**
 * 没在录制时的主界面：最近一次结果 / 开始失败、就绪提示、未完成的录制、录制设置与开始按钮。
 * 点插件图标时显示在网页面板里；网页不能注入时显示在工具栏弹窗里
 */
export function RecordingHome({
  status,
  onStart,
  disabled,
}: {
  status: (RecorderStatus & { startError?: string }) | undefined
  onStart: (request: Omit<StartRecordingRequest, 'tabId'>) => Promise<unknown>
  disabled?: boolean
}) {
  return (
    <>
      {status && <RecordingNotices status={status} />}
      <ReadinessStatus />
      <UnfinishedRecordings />
      <RecordingSetup onStart={onStart} disabled={disabled} />
    </>
  )
}

/**
 * 最近一次录制的结果 / 开始失败原因：录制面板关掉后，再点插件图标仍能看到；
 * 点「知道了」后清除，开始新的录制也会清除，不会一直挂着旧结果。
 */
function RecordingNotices({ status }: { status: RecorderStatus & { startError?: string } }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  if (!status.startError && !status.lastResult) return null
  const dismiss = async () => {
    await sendMessage('dismissRecordingNotice')
    await queryClient.invalidateQueries({ queryKey: ['recorderStatus'] })
  }
  return (
    <section className="flex flex-col gap-2">
      {status.startError && <StartErrorNotice error={status.startError} />}
      {status.lastResult && <LastRecordingNotice result={status.lastResult} />}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void dismiss()}>
          {t('popup.dismissNotice')}
        </Button>
        {status.lastResult && (
          <Button size="sm" variant="ghost" onClick={() => void sendMessage('openApp', '/')}>
            {t('sidepanel.openHistory')}
          </Button>
        )}
      </div>
    </section>
  )
}

/**
 * 就绪状态：文件夹未授权、API 未配置时提示，并一键跳转到插件网页处理；就绪时不显示。
 * 重新授权放在插件网页里完成：网页面板没有插件的文件夹句柄，弹窗失去焦点会被关闭，都不适合承载授权弹窗。
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

  // 就绪时不占位，只在需要处理时提示
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.key}
          className="bg-warning-soft text-body2 rounded-control flex items-center justify-between gap-2 py-2 pr-2 pl-3"
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
