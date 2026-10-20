import { useTranslation } from '@huilu/i18n'
import { Button, X, cn } from '@huilu/ui'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { formatDuration, useRecorderStatus } from '@/lib/recording'
import { RecordingStatusCard } from './RecordingStatusCard'

/**
 * 页面内悬浮录制面板：录制中的计时、暂停 / 继续、结束入口。
 * 固定在网页右下角之上（可拖动、可收起成小计时条、可关闭），不占网页布局。
 * 注意：标签页「音频 + 视频」录制会录下网页画面，面板展开时也会出现在视频里，收起后只剩小计时条。
 */
export function RecordingPanel({ onInactive }: { onInactive?: () => void }) {
  const { t } = useTranslation()
  // 关闭时立即隐藏，并由注入入口回收完整 UI 和监听器。
  const [hiddenFor, setHiddenFor] = useState<string>()
  const [collapsed, setCollapsed] = useState(false)
  const { data: status } = useRecorderStatus({ meterVisible: !collapsed, hiddenFor })
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 16 })
  const panel = useRef<HTMLElement | null>(null)
  const drag = useRef<{ x: number; y: number; right: number; bottom: number }>(undefined)
  const busy = status !== undefined && status.state !== 'idle'
  const key = busy ? (status.session?.id ?? 'busy') : 'idle'
  const hidden = hiddenFor === key
  const hasStatus = status !== undefined

  useEffect(() => {
    if (status?.state === 'idle') onInactive?.()
  }, [status?.state, onInactive])

  useEffect(() => {
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect()
      setPos((p) => ({
        right: Math.max(0, Math.min(p.right, window.innerWidth - (rect?.width ?? 288))),
        bottom: Math.max(0, Math.min(p.bottom, window.innerHeight - (rect?.height ?? 40))),
      }))
    }
    const observer = new ResizeObserver(clamp)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', clamp)
    clamp()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', clamp)
    }
  }, [collapsed, hidden, hasStatus])

  // Errors and saved results belong in the toolbar popup, never persist over a webpage.
  if (!status || hidden || !busy) return null

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, ...pos }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos({
      right: Math.max(
        0,
        Math.min(
          window.innerWidth - (panel.current?.getBoundingClientRect().width ?? 288),
          d.right - (e.clientX - d.x),
        ),
      ),
      bottom: Math.max(
        0,
        Math.min(
          window.innerHeight - (panel.current?.getBoundingClientRect().height ?? 40),
          d.bottom - (e.clientY - d.y),
        ),
      ),
    })
  }
  const onPointerUp = () => (drag.current = undefined)
  const style = { right: pos.right, bottom: pos.bottom }

  if (collapsed && busy && status.session) {
    return (
      <button
        ref={(node) => {
          panel.current = node
        }}
        type="button"
        style={style}
        className="huilu-panel bg-surface text-foreground shadow-float fixed flex items-center gap-2 rounded-full px-3 py-1.5 text-sm"
        onClick={() => setCollapsed(false)}
        title={t('panel.expand')}
      >
        <span
          className={cn(
            'size-2 rounded-full',
            status.state === 'recording'
              ? 'bg-danger motion-safe:animate-pulse'
              : 'bg-muted-foreground',
          )}
        />
        <span className="font-mono tabular-nums">{formatDuration(status.session.elapsedMs)}</span>
      </button>
    )
  }

  return (
    <section
      ref={(node) => {
        panel.current = node
      }}
      style={style}
      className="huilu-panel bg-surface text-foreground shadow-float fixed flex w-72 flex-col gap-3 rounded-3xl p-3 text-sm"
      role="dialog"
      aria-label={t('panel.title')}
    >
      <header
        className="flex cursor-move touch-none items-center justify-between gap-2 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      >
        <span className="pl-1 font-semibold">{t('app.name')}</span>
        <span className="flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {busy && (
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(true)}>
              {t('panel.collapse')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="px-2"
            aria-label={t('panel.close')}
            onClick={() => {
              setHiddenFor(key)
              onInactive?.()
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      </header>
      <RecordingStatusCard status={status} />
      {busy && <p className="text-muted-foreground px-1 text-xs">{t('panel.hint')}</p>}
    </section>
  )
}
