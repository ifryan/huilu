import { cn } from '@huilu/ui'

/** 弹窗里的单选按钮组（录制模式、来源、画质） */
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
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border px-2 py-1.5 text-sm',
            value === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border',
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
    <section className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </section>
  )
}
