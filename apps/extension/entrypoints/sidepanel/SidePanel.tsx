import { useTranslation } from '@huilu/i18n'
import { useQuery } from '@tanstack/react-query'
import { sendMessage } from '@/lib/messaging'

export function SidePanel() {
  const { t } = useTranslation()
  const { data: status } = useQuery({
    queryKey: ['recorderStatus'],
    queryFn: () => sendMessage('getRecorderStatus'),
    refetchInterval: 1000,
  })

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('app.name')}</h1>
      <div className="bg-muted rounded-xl p-4 text-sm">
        {status?.state === 'recording' ? t('sidepanel.recording') : t('sidepanel.idle')}
      </div>
    </main>
  )
}
