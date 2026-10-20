import { cn } from '@huilu/ui'

/** 弹窗里的开关行（录制画面、麦克风）：左侧文字，右侧 Board UI 风格的拨动开关，整行可点 */
export function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="text-body focus-visible:outline-ring flex items-center justify-between gap-2 rounded-sm text-left font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150',
          checked ? 'bg-primary' : 'bg-field',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white shadow-xs transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </button>
  )
}
