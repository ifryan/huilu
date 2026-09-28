// 实验：GLM Coding Plan 的工具请求头适配。纯逻辑（不依赖 WXT / zod），后台脚本据此同步 declarativeNetRequest 规则
import type { ProviderSettings } from './provider-settings'

/** 与 @huilu/providers 的 GLM_CODING_PLAN_BASE_URL 一致（单元测试保证）；这里不引入服务商实现，避免把 zod 打进后台 */
export const CODING_PLAN_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'

/** 公开参考实现（coding-plan-mask 的 claudecode 模式）使用的请求头；只作实验，不代表智谱认可 */
export const CODING_PLAN_HEADERS = {
  'user-agent': 'claude-cli/2.1.88 (external, cli)',
  'x-app': 'cli',
} as const

/** 本插件只使用这一个会话规则 ID */
export const CODING_PLAN_RULE_ID = 1

/** chrome.declarativeNetRequest.Rule 中用到的部分 */
export interface HeaderRule {
  id: number
  priority: number
  action: {
    type: 'modifyHeaders'
    requestHeaders: { header: string; operation: 'set'; value: string }[]
  }
  condition: {
    urlFilter: string
    initiatorDomains: string[]
    resourceTypes: 'xmlhttprequest'[]
  }
}

const trim = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * 已保存的大模型设置是否启用了请求头适配：当前服务商为 OpenAI 兼容、预设为 GLM Coding Plan、
 * Base URL 恰为 Coding Plan 端点，且开关未关闭（旧配置没有该字段时按默认「开启」）
 */
export function codingPlanHeadersEnabled(llm: ProviderSettings): boolean {
  if (llm.providerId !== 'openai-compatible') return false
  const config = llm.configs[llm.providerId]
  return (
    config?.preset === 'glmCodingPlan' &&
    typeof config.baseUrl === 'string' &&
    trim(config.baseUrl) === CODING_PLAN_BASE_URL &&
    (config.clientHeaders ?? 'claudeCli') === 'claudeCli'
  )
}

/**
 * 需要的会话规则：只匹配本插件（initiator 为插件自身）发起的 fetch / XHR，
 * 且 URL 以 Coding Plan 端点路径开头；不含 Authorization / Key。未启用时为空
 */
export function codingPlanRules(llm: ProviderSettings, extensionId: string): HeaderRule[] {
  if (!codingPlanHeadersEnabled(llm)) return []
  return [
    {
      id: CODING_PLAN_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: Object.entries(CODING_PLAN_HEADERS).map(([header, value]) => ({
          header,
          operation: 'set',
          value,
        })),
      },
      condition: {
        // | 锚定开头，末尾的 / 保证不会匹配到 /v4x 之类的其他路径
        urlFilter: `|${CODING_PLAN_BASE_URL}/`,
        initiatorDomains: [extensionId],
        resourceTypes: ['xmlhttprequest'],
      },
    },
  ]
}
