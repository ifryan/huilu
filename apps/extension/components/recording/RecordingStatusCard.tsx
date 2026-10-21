import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { checkMessageError } from '@/lib/extension-context'
import { sendMessage, type LastRecording, type RecorderStatus } from '@/lib/messaging'
import { formatBytes, formatDuration, startErrorText, warningText } from '@/lib/recording'

/** 录制中的状态卡：录音中 / 录屏中（红点）+ 计时 + 已录大小 + 暂停 / 继续 / 结束（二次确认） */
export function RecordingStatusCard({
  status,
  embedded = false,
}: {
  status: RecorderStatus
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const session = status.session
  const control = useMutation({
    mutationFn: (action: 'pauseRecording' | 'resumeRecording' | 'stopRecording') =>
      sendMessage(action),
    onSuccess: (next) => queryClient.setQueryData(['recorderStatus'], next),
    onSettled: () => setConfirming(false),
    onError: checkMessageError,
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
    <section className={cn('flex flex-col gap-3', embedded ? 'px-1' : 'bg-muted rounded-2xl p-4')}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            'size-2.5 rounded-full',
            live ? 'bg-danger motion-safe:animate-pulse' : 'bg-muted-foreground',
          )}
        />
        {label}
      </div>
      <div className="truncate text-sm" title={session.title}>
        {session.title}
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-3xl font-medium tabular-nums">
          {formatDuration(session.elapsedMs)}
        </span>
        <span className="text-muted-foreground text-xs">
          {t('sidepanel.recorded', { size: formatBytes(session.bytes) })}
        </span>
      </div>

      <RecordingAudioLevel status={status} />

      {session.warnings.map((w) => (
        <p key={w} className="bg-warning-soft text-warning rounded-lg px-2 py-1 text-xs">
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
      {control.error != null && <p className="text-danger text-xs">{String(control.error)}</p>}
    </section>
  )
}

/** 录制端每 50ms 取一个峰值（PEAK_INTERVAL_MS）；界面按同样的节奏匀速放出 */
const PEAK_MS = 50
/** 竖条宽 1.5px、间距 1.5px */
const BAR_WIDTH = 1.5
const BAR_PITCH = 3
const WAVE_HEIGHT = 20
/** 峰值低于它视为没有声音 */
const SILENT_PEAK = 0.05
/** 积压超过这么多个峰值（轮询卡顿后一次到了很多）就丢掉旧的，追上实时 */
const MAX_BACKLOG = 12

/**
 * 悬浮面板和再次打开的弹窗都显示同一路实际混音的波形：真实峰值从右往左滚动。
 * 状态每 200ms 轮询一次、一次带回约 4 个新峰值，这里按 50ms 一个匀速放出，并在两个之间平移，
 * 看起来是连续滚动。高度固定，「未检测到声音」与标题同一行，声音有无变化时卡片不会跳动。
 */
function RecordingAudioLevel({ status }: { status: RecorderStatus }) {
  const { t } = useTranslation()
  const session = status.session
  const live = status.state === 'recording'
  const latest = live ? session?.audioPeaks : undefined
  const canvas = useRef<HTMLCanvasElement>(null)
  const wave = useRef({ shown: [] as number[], queue: [] as number[], seen: -1, emittedAt: 0 })

  // 新到的峰值排进队列；total 用来去掉与上次重复的部分
  useEffect(() => {
    const w = wave.current
    if (!latest) {
      w.queue = []
      return
    }
    const fresh =
      w.seen < 0 ? latest.peaks.slice(-4) : latest.peaks.slice(-Math.max(0, latest.total - w.seen))
    w.seen = latest.total
    w.queue.push(...fresh)
    if (w.queue.length > MAX_BACKLOG) w.queue.splice(0, w.queue.length - MAX_BACKLOG)
  }, [latest])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      const w = wave.current
      const ratio = window.devicePixelRatio || 1
      const width = el.clientWidth
      const bars = Math.ceil(width / BAR_PITCH) + 1
      if (el.width !== Math.round(width * ratio)) {
        el.width = Math.round(width * ratio)
        el.height = Math.round(WAVE_HEIGHT * ratio)
      }
      // 每 50ms 放出一个；平时留一个垫底，轮询稍晚到时不会停顿。队列空了就停在原地，不凭空造波形
      const ready = w.queue.length > 1 || now - w.emittedAt >= 2 * PEAK_MS
      if (now - w.emittedAt >= PEAK_MS && w.queue.length > 0 && ready) {
        w.shown.push(w.queue.shift()!)
        if (w.shown.length > bars) w.shown.splice(0, w.shown.length - bars)
        w.emittedAt = now
      }
      const offset =
        !reduced && w.queue.length > 0 ? Math.min(1, (now - w.emittedAt) / PEAK_MS) * BAR_PITCH : 0
      const ctx = el.getContext('2d')!
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, WAVE_HEIGHT)
      ctx.fillStyle = getComputedStyle(el).color
      const mid = WAVE_HEIGHT / 2
      for (let i = 0; i < bars; i++) {
        // 最新的峰值贴着右边
        const peak = w.shown[w.shown.length - bars + i] ?? 0
        const height = Math.max(1.5, peak * WAVE_HEIGHT)
        const x = width - (bars - i) * BAR_PITCH + (BAR_PITCH - BAR_WIDTH) - offset
        ctx.beginPath()
        ctx.roundRect(x, mid - height / 2, BAR_WIDTH, height, BAR_WIDTH / 2)
        ctx.fill()
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!session) return null
  const silent = live && !(latest?.peaks.slice(-10).some((p) => p > SILENT_PEAK) ?? false)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{t('sidepanel.audioLevel')}</span>
        <span className="text-muted-foreground" aria-live="polite">
          {silent ? t('sidepanel.audioSilent') : ''}
        </span>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('sidepanel.audioLevel')}
        style={{ height: WAVE_HEIGHT }}
        className={cn('w-full', live && !silent ? 'text-primary' : 'text-muted-foreground/40')}
      />
    </div>
  )
}

/** 最近一次录制的结果：已保存 / 因来源结束而结束 / 出错后部分保存 / 未能保存 */
export function LastRecordingNotice({ result }: { result: LastRecording }) {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-surface shadow-card flex flex-col gap-1 rounded-2xl border p-4 text-sm">
      {result.saved ? (
        <>
          <div className="font-medium">
            {t(result.endReason === 'error' ? 'sidepanel.partiallySaved' : 'sidepanel.saved')}
          </div>
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
          {t('sidepanel.notSaved', { error: result.error ? startErrorText(t, result.error) : '' })}
        </p>
      )}
    </section>
  )
}

export function StartErrorNotice({ error }: { error: string }) {
  const { t } = useTranslation()
  return (
    <p className="bg-error-soft text-error rounded-2xl p-4 text-xs">
      {t('sidepanel.startFailed', { error: startErrorText(t, error) })}
    </p>
  )
}
