import { browser } from '#imports'

/**
 * Chrome 平台适配层：packages/* 不直接调用 chrome.*，
 * 需要的平台能力（打开页面、存储适配器、离屏文档等）都在这里实现后注入。
 */
export async function openAppPage(route = '/') {
  const url = browser.runtime.getURL(`/app.html#${route}`)
  await browser.tabs.create({ url })
}
