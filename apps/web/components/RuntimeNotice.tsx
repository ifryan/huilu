import { useTranslation } from '@huilu/i18n'
import { useQuery } from '@tanstack/react-query'
import { runtimeError } from '@/platform/runtime'
export function RuntimeNotice() {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['webRuntime'],
    queryFn: () => runtimeError ?? null,
    refetchInterval: 2000,
  })
  return data ? (
    <p className="bg-error-soft text-error rounded-control mb-4 p-3" role="alert">
      {t('web.runtimeError')}
    </p>
  ) : null
}
