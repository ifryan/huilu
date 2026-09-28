import { useTranslation } from '@huilu/i18n'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ReadinessBanner } from '@/components/ReadinessBanner'

export function Layout() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const linkClass =
    'whitespace-nowrap rounded-lg px-3 py-2 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium'

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border flex shrink-0 flex-wrap items-start gap-1 border-b p-4 md:w-48 md:flex-col md:flex-nowrap md:items-stretch md:border-r md:border-b-0">
        <div className="mb-2 w-full md:mb-4">
          <div className="text-xl font-semibold">{t('app.name')}</div>
          <div className="text-muted-foreground text-xs">{t('app.tagline')}</div>
        </div>
        <Link to="/" className={linkClass}>
          {t('nav.history')}
        </Link>
        <Link to="/settings" className={linkClass}>
          {t('nav.settings')}
        </Link>
      </aside>
      <main className="min-w-0 flex-1 p-4 lg:p-7">
        {pathname !== '/onboarding' && <ReadinessBanner className="mb-6 max-w-2xl" />}
        <Outlet />
      </main>
    </div>
  )
}
