import { useTranslation } from '@huilu/i18n'
import { Link, Outlet } from '@tanstack/react-router'

export function Layout() {
  const { t } = useTranslation()
  const linkClass =
    'rounded-lg px-3 py-2 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium'

  return (
    <div className="flex min-h-screen">
      <aside className="border-border flex w-56 flex-col gap-1 border-r p-4">
        <div className="mb-4">
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
      <main className="flex-1 p-8">
        <Outlet />
      </main>
    </div>
  )
}
