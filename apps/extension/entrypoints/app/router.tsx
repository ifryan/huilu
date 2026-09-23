import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { HistoryPage } from './routes/HistoryPage'
import { Layout } from './routes/Layout'
import { OnboardingPage } from './routes/OnboardingPage'
import { SettingsPage } from './routes/SettingsPage'

// 插件页面使用 hash 路由：chrome-extension://<id>/app.html#/settings
const rootRoute = createRootRoute({ component: Layout })

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: HistoryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/onboarding', component: OnboardingPage }),
])

export const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
