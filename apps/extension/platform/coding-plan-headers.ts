import { browser, type Browser } from '#imports'
import { codingPlanRules } from '@/lib/coding-plan'
import { llmSetting } from '@/lib/settings'

let pending: Promise<void> = Promise.resolve()

/**
 * 按已保存的大模型设置同步 GLM Coding Plan 请求头规则（实验）。
 * 用会话规则：浏览器重启后自动清空，由后台启动时重新同步，不会留下过期的持久规则；
 * 每次先移除本插件的全部会话规则再按当前设置添加，关闭或切换服务商后规则即被清理。
 * 串行执行，避免设置连续变化时交错
 */
export function syncCodingPlanHeaders(): Promise<void> {
  const run = pending.then(async () => {
    const rules = codingPlanRules(await llmSetting.getValue(), browser.runtime.id)
    const existing = await browser.declarativeNetRequest.getSessionRules()
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: rules as Browser.declarativeNetRequest.Rule[],
    })
  })
  pending = run.catch(() => {})
  return run
}
