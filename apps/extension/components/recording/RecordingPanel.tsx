import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { useRef, useState, type PointerEvent } from 'react'
import { sendMessage } from '@/lib/messaging'
import { formatDuration, useRecorderStatus } from '@/lib/recording'
import { LastRecordingNotice, RecordingStatusCard, StartErrorNotice } from './RecordingStatusCard'

/**
 * 页面内悬浮录制面板：录制中唯一的计时、暂停 / 继续、结束和错误提示入口。
 * 固定在网页右下角之上（可拖动、可收起成小计时条、可关闭），不占网页布局。
 * 注意：标签页「音频 + 视频」录制会录下网页画面，面板展开时也会出现在视频里，收起后只剩小计时条。
 */
export function RecordingPanel() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  // 关闭时记下当时的录制（或「空闲」）；换了一场录制就重新显示
  const [hiddenFor, setHiddenFor] = useState<string>()
  const [collapsed, setCollapsed] = useState(false)
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 16 })
  const drag = useRef<{ x: number; y: number; right: number; bottom: number }>(undefined)
  const busy = status !== undefined && status.state !== 'idle'
  const key = busy ? (status.session?.id ?? 'busy') : 'idle'
  const hidden = hiddenFor === key

  if (!status || hidden) return null
  const startError = status.startError
  // 未被关掉的最近一次结果：面板重新注入（快捷键结束、弹窗重新打开）后照样显示
  const lastResult = status.lastResult
  // 空闲、也没有需要告知的结果：什么都不显示
  if (!busy && !startError && !lastResult) return null

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, ...pos }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos({
      right: Math.max(0, Math.min(window.innerWidth - 80, d.right - (e.clientX - d.x))),
      bottom: Math.max(0, Math.min(window.innerHeight - 40, d.bottom - (e.clientY - d.y))),
    })
  }
  const onPointerUp = () => (drag.current = undefined)
  const style = { right: pos.right, bottom: pos.bottom }

  if (collapsed && busy && status.session) {
    return (
      <button
        type="button"
        style={style}
        className="bg-background text-foreground border-border fixed flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-lg"
        onClick={() => setCollapsed(false)}
        title={t('panel.expand')}
      >
        <span
          className={cn(
            'size-2 rounded-full',
            status.state === 'recording' ? 'bg-danger animate-pulse' : 'bg-muted-foreground',
          )}
        />
        <span className="font-mono tabular-nums">{formatDuration(status.session.elapsedMs)}</span>
      </button>
    )
  }

  return (
    <section
      style={style}
      className="bg-background text-foreground border-border fixed flex w-72 flex-col gap-3 rounded-2xl border p-3 text-sm shadow-xl"
      role="dialog"
      aria-label={t('panel.title')}
    >
      <header
        className="flex cursor-move items-center justify-between gap-2 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="font-semibold">{t('app.name')}</span>
        <span className="flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {busy && (
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(true)}>
              {t('panel.collapse')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('panel.close')}
            onClick={() => {
              setHiddenFor(key)
              // 空闲时关掉面板 = 看过了结果，弹窗里也不再提示
              if (!busy) void sendMessage('dismissRecordingNotice')
            }}
          >
            ✕
          </Button>
        </span>
      </header>
      {busy ? (
        <RecordingStatusCard status={status} />
      ) : (
        <>
          {startError && <StartErrorNotice error={startError} />}
          {lastResult && <LastRecordingNotice result={lastResult} />}
          <Button variant="outline" size="sm" onClick={() => void sendMessage('openApp', '/')}>
            {t('sidepanel.openHistory')}
          </Button>
        </>
      )}
      {busy && <p className="text-muted-foreground text-xs">{t('panel.hint')}</p>}
    </section>
  )
}
