import { useTranslation } from '@huilu/i18n'

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
    <details className="text-sm">
      <summary className="text-primary cursor-pointer">{t('settings.compare.title')}</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-border border-b">
              {columns.map((c) => (
                <th key={c} className="px-2 py-2 font-medium">
                  {t(`settings.compare.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id} className="border-border border-b align-top last:border-0">
                <td className="px-2 py-2 font-medium">{t(`settings.compare.${row.id}.name`)}</td>
                <td className="px-2 py-2">{t(`settings.compare.${row.id}.access`)}</td>
                <td className="px-2 py-2">{t(`settings.compare.${row.id}.free`)}</td>
                <td className="px-2 py-2">{t(`settings.compare.${row.id}.price`)}</td>
                <td className="px-2 py-2">
                  {row.diarization === 'yes' ? '✅ ' : row.diarization === 'no' ? '❌ ' : ''}
                  {t(`settings.compare.${row.diarization}`)}
                </td>
                <td className="px-2 py-2">
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
