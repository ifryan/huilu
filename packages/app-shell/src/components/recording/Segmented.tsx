import { cn } from '@huilu/ui'

/** 弹窗里的单选按钮组（录制模式、来源、画质）：Board UI 分段控件，灰色轨道 + 抬起的选中项 */
export function Segmented<V extends string | number>({
  value,
  options,
  onChange,
}: {
  value: V
  options: { value: V; label: string }[]
  onChange: (value: V) => void
}) {
  return (
    <div
      className="bg-field rounded-control grid gap-0.5 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'text-body2 focus-visible:outline-ring truncate rounded-md px-2 py-1.5 transition-colors duration-150 focus-visible:outline-2',
            value === o.value
              ? 'bg-surface text-foreground font-medium shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <span className="text-body2 font-medium">{label}</span>
      {children}
    </section>
  )
}
