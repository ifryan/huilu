import { useTranslation } from '@huilu/i18n'
import { History, Settings } from '@huilu/ui'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ReadinessBanner } from '@/components/ReadinessBanner'

/**
 * 宽屏：Board UI 浮动侧栏（宽 260、外边距 12、圆角 24、内边距 12）；窄屏改为顶部导航条。
 * 结果页底部播放条按侧栏占位 12 + 260 + 12 = 284px 对齐，改宽度时一起改。
 */
export function Layout() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const linkClass =
    'text-body text-foreground hover:bg-muted rounded-control flex items-center gap-2 whitespace-nowrap px-2 py-2 transition-colors duration-150 focus-visible:outline-ring focus-visible:outline-2 [&.active]:bg-gradient-primary [&.active]:text-primary-foreground [&.active]:font-medium [&.active]:shadow-xs [&_svg]:size-5 [&_svg]:shrink-0'

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border bg-surface md:shadow-float flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-3 md:sticky md:top-3 md:m-3 md:h-[calc(100vh-24px)] md:w-[260px] md:flex-col md:flex-nowrap md:items-stretch md:gap-1 md:rounded-3xl md:border-0 md:p-3">
        <div className="mr-auto md:mr-0 md:mb-4 md:px-2 md:pt-2">
          <div className="text-headline font-semibold">{t('app.name')}</div>
          <div className="text-muted-foreground text-caption hidden md:block">
            {t('app.tagline')}
          </div>
        </div>
        <Link to="/" className={linkClass}>
          <History aria-hidden="true" />
          {t('nav.history')}
        </Link>
        <Link to="/settings" className={linkClass}>
          <Settings aria-hidden="true" />
          {t('nav.settings')}
        </Link>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-7 lg:px-8">
        {pathname !== '/onboarding' && <ReadinessBanner className="mb-6 max-w-2xl" />}
        <Outlet />
      </main>
    </div>
  )
}
