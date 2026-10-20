export async function openAppPage(route = '/') {
  window.location.hash = route
}
export async function hasHostPermission(url: string) {
  const parsed = new URL(url)
  return ['http:', 'https:'].includes(parsed.protocol) && !parsed.pathname.includes('/api/coding/')
}
export const requestHostPermission = hasHostPermission
