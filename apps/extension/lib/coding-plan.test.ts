import { GLM_CODING_PLAN_BASE_URL, ZHIPU_BASE_URL, describeConfigFields } from '@huilu/providers'
import { describe, expect, it } from 'vitest'
import { CODING_PLAN_BASE_URL, codingPlanHeadersEnabled, codingPlanRules } from './coding-plan'
import {
  applyPreset,
  getProvider,
  initialFormValues,
  parseForm,
  visibleFields,
  type ProviderSettings,
} from './providers'

const llm = getProvider('llm', 'openai-compatible')
const EXTENSION_ID = 'fddknloecifbbeomieckhnegffdobgni'

function settingsFor(config: Record<string, unknown>, providerId = 'openai-compatible') {
  return { providerId, configs: { [providerId]: config } } satisfies ProviderSettings
}

const codingPlan = {
  preset: 'glmCodingPlan',
  baseUrl: CODING_PLAN_BASE_URL,
  apiKey: 'plan-key',
  model: 'glm-x',
  clientHeaders: 'claudeCli',
}

describe('GLM Coding Plan presets', () => {
  it('keeps the standard Zhipu API and the Coding Plan endpoint separate', () => {
    expect(CODING_PLAN_BASE_URL).toBe(GLM_CODING_PLAN_BASE_URL)
    const zhipu = applyPreset(llm, initialFormValues(llm), 'zhipu')
    const plan = applyPreset(llm, initialFormValues(llm), 'glmCodingPlan')
    expect(zhipu.baseUrl).toBe(ZHIPU_BASE_URL)
    expect(plan.baseUrl).toBe(GLM_CODING_PLAN_BASE_URL)
    // 模型名不预填；两个预设都要求 Key
    expect(parseForm(llm, { ...plan, apiKey: '' })).toMatchObject({ ok: false })
    expect(parseForm(llm, { ...plan, apiKey: '', model: 'glm-x' })).toEqual({
      ok: false,
      invalidKeys: ['apiKey'],
    })
    expect(parseForm(llm, { ...plan, apiKey: 'k' })).toEqual({ ok: false, invalidKeys: ['model'] })
    expect(parseForm(llm, { ...zhipu, apiKey: 'k', model: 'glm-x' }).ok).toBe(true)
  })

  it('shows the header switch only for the Coding Plan preset', () => {
    const fields = describeConfigFields(llm.configSchema)
    const keys = (preset: string) => visibleFields(fields, { preset }).map((f) => f.key)
    expect(keys('glmCodingPlan')).toContain('clientHeaders')
    for (const preset of ['zhipu', 'qwen', 'custom']) {
      expect(keys(preset)).not.toContain('clientHeaders')
    }
  })
})

describe('coding plan header rules', () => {
  it('adds one rule scoped to the extension and the coding endpoint path', () => {
    const rules = codingPlanRules(settingsFor(codingPlan), EXTENSION_ID)
    expect(rules).toEqual([
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'user-agent', operation: 'set', value: 'claude-cli/2.1.88 (external, cli)' },
            { header: 'x-app', operation: 'set', value: 'cli' },
          ],
        },
        condition: {
          urlFilter: '|https://open.bigmodel.cn/api/coding/paas/v4/',
          initiatorDomains: [EXTENSION_ID],
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ])
    // 规则里不能带凭据
    expect(JSON.stringify(rules)).not.toContain('plan-key')
    expect(JSON.stringify(rules).toLowerCase()).not.toContain('authorization')
  })

  it('treats old saved configs without the switch as enabled, trailing slash included', () => {
    const { clientHeaders: _, ...old } = codingPlan
    expect(
      codingPlanHeadersEnabled(settingsFor({ ...old, baseUrl: `${CODING_PLAN_BASE_URL}/` })),
    ).toBe(true)
  })

  it('adds nothing when switched off, on other presets / providers or another URL', () => {
    const none = [
      settingsFor({ ...codingPlan, clientHeaders: 'off' }),
      settingsFor({ ...codingPlan, preset: 'zhipu', baseUrl: ZHIPU_BASE_URL }),
      // 普通 API 预设即使手填了 Coding Plan 地址也不加
      settingsFor({ ...codingPlan, preset: 'custom' }),
      settingsFor({ ...codingPlan, baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v5' }),
      settingsFor({ ...codingPlan, baseUrl: 'https://proxy.example/api/coding/paas/v4' }),
      // 选中的服务商不是 OpenAI 兼容：即使保存过 Coding Plan 配置也不加
      { providerId: 'other', configs: { 'openai-compatible': codingPlan } },
      { providerId: 'openai-compatible', configs: {} },
    ]
    for (const settings of none) expect(codingPlanRules(settings, EXTENSION_ID)).toEqual([])
  })
})
