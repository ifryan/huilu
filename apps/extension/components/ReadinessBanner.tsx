import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useFolderActions, useReadiness } from '@/lib/readiness'

function Notice({ title, note, action }: { title: string; note?: string; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="text-sm">
        <div className="font-medium">{title}</div>
        {note && <div className="text-muted-foreground text-xs">{note}</div>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

/**
 * 插件网页顶部的就绪提示。文件夹授权失效时直接在这里一键重新授权
 * （可见页面的点击事件，满足 requestPermission 的用户激活要求）。
 */
export function ReadinessBanner({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { data } = useReadiness()
  const { pick, reauthorize } = useFolderActions()
  const [error, setError] = useState<string>()

  if (!data) return null
  const run = (action: () => Promise<unknown>) => () => {
    setError(undefined)
    action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const notices: ReactNode[] = []
  if (!data.onboarded) {
    notices.push(
      <Notice
        key="onboarding"
        title={t('readiness.onboarding')}
        action={
          <Button size="sm" asChild>
            <Link to="/onboarding">{t('readiness.configure')}</Link>
          </Button>
        }
      />,
    )
  } else {
    const { permission } = data.folder
    if (permission !== 'granted') {
      notices.push(
        <Notice
          key="folder"
          title={
            permission === 'prompt'
              ? t('readiness.folderPrompt')
              : permission === 'denied'
                ? t('readiness.folderDenied')
                : t('readiness.folderUnset')
          }
          note={t('readiness.folderNote')}
          action={
            <Button size="sm" onClick={run(permission === 'prompt' ? reauthorize : pick)}>
              {permission === 'prompt' ? t('readiness.reauthorize') : t('readiness.chooseFolder')}
            </Button>
          }
        />,
      )
    }
    if (!data.transcription || !data.llm) {
      notices.push(
        <Notice
          key="api"
          title={t('readiness.apiMissing')}
          note={t('readiness.apiNote')}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/settings">{t('readiness.configure')}</Link>
            </Button>
          }
        />,
      )
    }
  }

  if (notices.length === 0) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {notices}
      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  )
}
