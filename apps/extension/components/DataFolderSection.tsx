import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useMutation } from '@tanstack/react-query'
import { formatBytes } from '@/lib/providers'
import { useFolderActions, useReadiness } from '@/lib/readiness'
import { dataFolder } from '@/platform/storage'
import { Section, StatusPill } from './Section'

/** 数据文件夹：路径（名称）与授权状态、选择 / 更换、重新授权、占用空间 */
export function DataFolderSection({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { data } = useReadiness()
  const { pick, reauthorize } = useFolderActions()
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() })
  const usage = useMutation({ mutationFn: () => dataFolder.usage() })

  const folder = data?.folder
  const permission = folder?.permission ?? 'unset'

  return (
    <Section
      title={t('settings.dataFolder')}
      description={compact ? t('onboarding.step1Desc') : undefined}
      aside={
        <StatusPill ok={permission === 'granted'}>
          {t(`settings.folder.status.${permission}`)}
        </StatusPill>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">
            {t('settings.folder.current')}
            {t('common.colon')}
          </span>
          <span className="font-mono">{folder?.name || t('settings.folder.none')}</span>
        </div>
        <div className="flex gap-2">
          {permission === 'prompt' && (
            <Button size="sm" onClick={() => action.mutate(reauthorize)}>
              {t('settings.folder.reauthorize')}
            </Button>
          )}
          <Button
            size="sm"
            variant={permission === 'unset' ? 'default' : 'outline'}
            onClick={() => {
              usage.reset()
              action.mutate(pick)
            }}
          >
            {permission === 'unset' ? t('settings.folder.choose') : t('settings.folder.change')}
          </Button>
        </div>
      </div>

      {action.error && (
        <p className="text-danger text-sm">
          {t('settings.folder.pickFailed', { reason: action.error.message })}
        </p>
      )}

      {!compact && permission === 'granted' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {t('settings.folder.usage')}
            {t('common.colon')}
          </span>
          {usage.data !== undefined ? (
            <span>{formatBytes(usage.data)}</span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={usage.isPending}
              onClick={() => usage.mutate()}
            >
              {usage.isPending ? '…' : t('settings.folder.calcUsage')}
            </Button>
          )}
          {usage.error && <span className="text-danger">{usage.error.message}</span>}
        </div>
      )}

      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
        {permission === 'unset' && <li>{t('settings.folder.suggestion')}</li>}
        <li>{t('settings.folder.persistHint')}</li>
        <li>{t('settings.folder.reloadHint')}</li>
        <li>{t('readiness.folderNote')}</li>
        <li>{t('settings.folder.pathNote')}</li>
      </ul>
    </Section>
  )
}
