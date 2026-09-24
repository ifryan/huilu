import type { ReactNode } from 'react'

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
    <section className="border-border flex flex-col gap-4 rounded-2xl border p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={
        ok
          ? 'shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs whitespace-nowrap text-emerald-700 dark:text-emerald-400'
          : 'shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs whitespace-nowrap text-amber-700 dark:text-amber-400'
      }
    >
      {children}
    </span>
  )
}

export const inputClass =
  'border-border bg-background w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 aria-invalid:border-danger'
