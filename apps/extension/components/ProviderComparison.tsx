import { useTranslation } from '@huilu/i18n'
import { ChevronDown } from '@huilu/ui'

const ROWS = [
  { id: 'paraformer', diarization: 'yes', domestic: true },
  { id: 'groq', diarization: 'no', domestic: false },
  { id: 'openai', diarization: 'byModel', domestic: false },
] as const

/** 转写服务商对比表（PRD 5.2） */
export function ProviderComparison() {
  const { t } = useTranslation()
  const columns = ['service', 'access', 'free', 'price', 'diarization', 'domestic'] as const

  return (
    <details className="group text-sm">
      <summary className="text-primary rounded-control hover:bg-muted inline-flex cursor-pointer list-none items-center gap-1 px-2 py-1 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden="true"
          className="size-4 -rotate-90 transition-transform group-open:rotate-0"
        />
        {t('settings.compare.title')}
      </summary>
      <div className="border-border bg-surface shadow-card mt-2 overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-border bg-muted text-muted-foreground border-b">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2.5 font-medium">
                  {t(`settings.compare.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id} className="border-border border-b align-top last:border-0">
                <td className="px-3 py-2.5 font-medium">{t(`settings.compare.${row.id}.name`)}</td>
                <td className="px-3 py-2.5">{t(`settings.compare.${row.id}.access`)}</td>
                <td className="px-3 py-2.5">{t(`settings.compare.${row.id}.free`)}</td>
                <td className="px-3 py-2.5">{t(`settings.compare.${row.id}.price`)}</td>
                <td className="px-3 py-2.5">
                  {row.diarization === 'yes' ? '✅ ' : row.diarization === 'no' ? '❌ ' : ''}
                  {t(`settings.compare.${row.diarization}`)}
                </td>
                <td className="px-3 py-2.5">
                  {row.domestic
                    ? `✅ ${t('settings.compare.yes')}`
                    : `❌ ${t('settings.compare.needsProxy')}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
