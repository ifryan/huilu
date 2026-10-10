import { useTranslation } from '@huilu/i18n'
import { AlertCircle, Button, cn } from '@huilu/ui'
import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { useFolderActions, useReadiness } from '@/lib/readiness'

function Notice({ title, note, action }: { title: string; note?: string; action: ReactNode }) {
  return (
    <div className="border-border bg-surface shadow-card flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3">
      <span className="bg-warning-soft text-warning flex size-8 shrink-0 items-center justify-center rounded-full">
        <AlertCircle className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-40 flex-1">
        <div className="text-body font-medium">{title}</div>
        {note && <div className="text-muted-foreground text-body2">{note}</div>}
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
