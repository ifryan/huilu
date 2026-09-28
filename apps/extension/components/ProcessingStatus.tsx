import { useTranslation } from '@huilu/i18n'
import type { ProcessingJob } from '@huilu/pipeline/jobs'
import type { LocalRecording } from '@huilu/recorder'
import { Button } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useDynamicT } from '@/lib/i18n'
import { libraryKey } from '@/lib/library'
import { sendMessage } from '@/lib/messaging'
import { processingJobsKey } from '@/lib/processing-jobs'
import {
  errorKey,
  processingView,
  type ProcessingReadiness,
  type ProcessingView,
} from '@/lib/processing-view'
import { useFolderActions } from '@/lib/readiness'

/**
 * 历史记录中一场录制的会后处理状态与操作：补转写、重试、生成纪要、授权数据文件夹后补写。
 * 录制、预览不依赖这里：没有配置 API、没有数据文件夹时照常可用。
 * 任务列表与就绪状态由历史页统一查询 / 订阅一次后传入，每行不再各自轮询和监听设置
 */
export function ProcessingStatus({
  recording,
  job,
  readiness,
}: {
  recording: LocalRecording
  job: ProcessingJob | undefined
  readiness: ProcessingReadiness | undefined
}) {
  const { t } = useTranslation()
  const dt = useDynamicT()
  const queryClient = useQueryClient()
  const { pick, reauthorize } = useFolderActions()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const view = processingView(recording, job, readiness)
  if (view.kind === 'none') return null

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: processingJobsKey }),
      queryClient.invalidateQueries({ queryKey: libraryKey }),
    ])

  const process = () => {
    setBusy(true)
    setActionError(undefined)
    sendMessage('processMeeting', recording.id)
      .then((result) => {
        if (!result.queued) setActionError(t(`processing.notQueued.${result.reason}`))
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false)
        void refresh()
      })
  }

  // 授权必须在点击事件里直接调用（用户激活），离屏文档自己无法申请
  const authorize = () => {
    setActionError(undefined)
    const action = readiness?.folder === 'prompt' ? reauthorize : pick
    action()
      .then(refresh)
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
  }

  const reason = (error: { code: string; detail?: string }) =>
    error.detail ? `${dt(errorKey(error.code))} (${error.detail})` : dt(errorKey(error.code))

  const settingsLink = (
    <Button size="sm" variant="outline" asChild>
      <Link to="/settings">{t('processing.goSettings')}</Link>
    </Button>
  )

  const content = render(view)
  return (
    <div className="flex flex-col gap-2 text-xs">
      {content}
      {actionError && <p className="text-danger">{actionError}</p>}
    </div>
  )

  function render(v: ProcessingView) {
    switch (v.kind) {
      case 'none':
        return null
      case 'noAudio':
        return <p>{t('history.noTranscriptAudio')}</p>
      case 'ready':
        return <p>{t('history.transcribed')}</p>
      case 'idle':
        return (
          <>
            <p>{v.canStart ? t('history.notTranscribed') : t('history.notTranscribedNoService')}</p>
            {v.canStart && v.transcriptOnly && (
              <p className="text-muted-foreground">{t('processing.transcriptOnly')}</p>
            )}
            <div className="flex gap-2">
              {v.canStart ? (
                <Button size="sm" disabled={busy} onClick={process}>
                  {t('processing.start')}
                </Button>
              ) : (
                settingsLink
              )}
            </div>
          </>
        )
      case 'queued':
        return <p>{t('processing.queued')}</p>
      case 'running':
        return (
          <div className="flex items-center gap-2">
            <span>{t(`processing.step.${v.step}`)}</span>
            {v.progress !== undefined && (
              <>
                <progress className="h-1.5 w-32" max={1} value={v.progress} />
                <span>{Math.round(v.progress * 100)}%</span>
              </>
            )}
          </div>
        )
      case 'retrying':
        return (
          <p className="text-amber-700 dark:text-amber-400">
            {t('processing.retrying', {
              step: t(`processing.stepName.${v.error.step}`),
              reason: reason(v.error),
              time: new Date(v.at).toLocaleTimeString(),
            })}
          </p>
        )
      case 'waitingFolder':
        return (
          <>
            <p>{t('processing.waitingFolder')}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={authorize}>
                {v.permission === 'prompt'
                  ? t('processing.authorizeFolder')
                  : t('processing.chooseFolder')}
              </Button>
            </div>
          </>
        )
      case 'failed':
        return (
          <>
            <p className="text-danger break-all">
              {t('processing.failed', {
                step: t(`processing.stepName.${v.error.step}`),
                reason: reason(v.error),
              })}
            </p>
            <div className="flex gap-2">
              {v.canRetry ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={process}>
                  {t('processing.retry')}
                </Button>
              ) : (
                settingsLink
              )}
            </div>
          </>
        )
      case 'done':
        return (
          <>
            <p className="text-emerald-700 dark:text-emerald-400">
              {v.folderDir
                ? t('processing.done', { folder: v.folderDir })
                : t('history.transcribed')}
            </p>
            {v.summarySkipped && (
              <p className="text-muted-foreground">
                {t(`processing.summarySkipped.${v.summarySkipped}`)}
              </p>
            )}
            {v.canSummarize && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={process}>
                  {t('processing.summarize')}
                </Button>
              </div>
            )}
          </>
        )
    }
  }
}
