import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { sendMessage, type LastRecording, type RecorderStatus } from '@/lib/messaging'
import { formatBytes, formatDuration, startErrorText, warningText } from '@/lib/recording'

/** 录制中的状态卡：录音中 / 录屏中（红点）+ 计时 + 已录大小 + 暂停 / 继续 / 结束（二次确认） */
export function RecordingStatusCard({ status }: { status: RecorderStatus }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const session = status.session
  const control = useMutation({
    mutationFn: (action: 'pauseRecording' | 'resumeRecording' | 'stopRecording') =>
      sendMessage(action),
    onSuccess: (next) => queryClient.setQueryData(['recorderStatus'], next),
    onSettled: () => setConfirming(false),
  })
  if (!session) return null

  const live = status.state === 'recording'
  const label =
    status.state === 'paused'
      ? t('sidepanel.paused')
      : status.state === 'stopping'
        ? t('sidepanel.stopping')
        : status.state === 'starting'
          ? t('sidepanel.starting')
          : session.mode === 'video'
            ? t('sidepanel.recordingVideo')
            : t('sidepanel.recordingAudio')

  return (
    <section className="bg-muted flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            'size-2.5 rounded-full',
            live ? 'bg-danger animate-pulse' : 'bg-muted-foreground',
          )}
        />
        {label}
      </div>
      <div className="truncate text-sm" title={session.title}>
        {session.title}
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-3xl tabular-nums">{formatDuration(session.elapsedMs)}</span>
        <span className="text-muted-foreground text-xs">
          {t('sidepanel.recorded', { size: formatBytes(session.bytes) })}
        </span>
      </div>

      {session.warnings.map((w) => (
        <p key={w} className="rounded-md bg-amber-500/10 px-2 py-1 text-xs">
          {warningText(t, w)}
        </p>
      ))}

      {(status.state === 'recording' || status.state === 'paused') &&
        (confirming ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm">{t('sidepanel.confirmStop')}</span>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t('sidepanel.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={control.isPending}
                onClick={() => control.mutate('stopRecording')}
              >
                {t('sidepanel.confirmStopAction')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={control.isPending}
              onClick={() => control.mutate(live ? 'pauseRecording' : 'resumeRecording')}
            >
              {live ? t('sidepanel.pause') : t('sidepanel.resume')}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t('sidepanel.stop')}
            </Button>
          </div>
        ))}
      {control.error && <p className="text-danger text-xs">{String(control.error)}</p>}
    </section>
  )
}

/** 最近一次录制的结果：已保存 / 因来源结束或写入失败而结束 / 未能保存 */
export function LastRecordingNotice({ result }: { result: LastRecording }) {
  const { t } = useTranslation()
  return (
    <section className="border-border flex flex-col gap-1 rounded-xl border p-4 text-sm">
      {result.saved ? (
        <>
          <div className="font-medium">{t('sidepanel.saved')}</div>
          <div className="text-muted-foreground text-xs">
            {t('sidepanel.savedDetail', {
              title: result.title,
              duration: formatDuration(result.durationMs),
            })}
          </div>
          {result.endReason === 'source-ended' && (
            <p className="text-xs">{t('sidepanel.endedBySource')}</p>
          )}
          {result.endReason === 'error' && (
            <p className="text-danger text-xs">
              {t('sidepanel.endedByError')}
              {result.error && <span className="block opacity-70">{result.error}</span>}
            </p>
          )}
        </>
      ) : (
        <p className="text-danger text-xs">
          {t('sidepanel.notSaved', { error: result.error ?? '' })}
        </p>
      )}
    </section>
  )
}

export function StartErrorNotice({ error }: { error: string }) {
  const { t } = useTranslation()
  return (
    <p className="border-border text-danger rounded-xl border p-4 text-xs">
      {t('sidepanel.startFailed', { error: startErrorText(t, error) })}
    </p>
  )
}
