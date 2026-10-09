import { cn } from '@huilu/ui'
import type { ReactNode } from 'react'

/** 设置分组卡片：白底细描边、圆角 16、轻投影（Board UI 卡片 / 表格容器） */
export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string
  description?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-border bg-surface shadow-card flex flex-col gap-4 rounded-2xl border p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-headline font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground text-body2 mt-1">{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const TONES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  error: 'bg-error-soft text-error',
  info: 'bg-primary-soft text-primary',
  neutral: 'bg-field text-muted-foreground',
}

/** 状态标签（Board UI 表格状态）：浅色底 + 同色系文字，圆角 6；颜色之外始终有文字 */
export function StatusPill({
  ok,
  tone = ok ? 'success' : 'warning',
  className,
  children,
}: {
  ok?: boolean
  tone?: StatusTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'text-caption inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
