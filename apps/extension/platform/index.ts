import { browser } from '#imports'

/**
 * Chrome 平台适配层：packages/* 不直接调用 chrome.*，
 * 需要的平台能力（打开页面、存储适配器、离屏文档等）都在这里实现后注入。
 */
export async function openAppPage(route = '/') {
  const url = browser.runtime.getURL(`/app.html#${route}`)
  await browser.tabs.create({ url })
}

/**
 * 申请访问某个服务商地址的权限（自定义 Base URL 用）。已声明或已授予时不会弹窗。
 * 必须在点击事件里、且在其他 await 之前调用，否则会丢失用户激活。
 */
export function requestHostPermission(url: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(url)] })
}

/** 是否已能访问该地址（manifest 已声明或用户已授予）；不弹窗，任何页面都能调用 */
export function hasHostPermission(url: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(url)] })
}

function originPattern(url: string) {
  const { protocol, hostname } = new URL(url)
  // 匹配模式不含端口，写成主机名即可匹配该主机的所有端口
  return `${protocol}//${hostname}/*`
}
