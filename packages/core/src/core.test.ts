import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  MEETING_SCHEMA_VERSION,
  Registry,
  defineSummaryTemplate,
  generalSummaryTemplate,
  migrateMeeting,
  registries,
  type LlmProvider,
  type Summary,
  type SummaryTemplateOutput,
} from './index'

const meeting = {
  schemaVersion: 1,
  id: 'm1',
  title: '需求评审',
  createdAt: '2026-09-24T06:30:00Z',
  durationMs: 60_000,
  mode: 'video',
  videoSource: 'tab',
  language: 'zh',
  status: 'ready',
}

describe('migrateMeeting', () => {
  it('parses a current-version meeting and fills defaults', () => {
    const m = migrateMeeting(meeting)
    expect(m.schemaVersion).toBe(MEETING_SCHEMA_VERSION)
    expect(m.speakers).toEqual([])
    expect(m.providers).toEqual({})
  })

  it('rejects data from a newer version', () => {
    expect(() => migrateMeeting({ ...meeting, schemaVersion: 999 })).toThrow(/高于当前支持/)
  })

  it('treats a missing schemaVersion as v1', () => {
    const { schemaVersion: _, ...legacy } = meeting
    expect(migrateMeeting(legacy).schemaVersion).toBe(MEETING_SCHEMA_VERSION)
  })

  it.each([['999'], ['1'], [1.5], [-1], [0], [null]])(
    'rejects a non-positive-integer schemaVersion (%j)',
    (schemaVersion) => {
      expect(() => migrateMeeting({ ...meeting, schemaVersion })).toThrow(/schemaVersion 无效/)
    },
  )

  it('rejects invalid data', () => {
    expect(() => migrateMeeting({ ...meeting, mode: 'gif' })).toThrow()
    expect(() => migrateMeeting(null)).toThrow()
  })
})

describe('Registry', () => {
  it('registers, lists and rejects duplicates', () => {
    const r = new Registry<{ id: string }>('thing')
    r.register({ id: 'a' })
    expect(r.get('a')).toEqual({ id: 'a' })
    expect(r.list()).toHaveLength(1)
    expect(() => r.register({ id: 'a' })).toThrow(/已注册/)
    expect(() => r.get('b')).toThrow(/未找到/)
  })
})

describe('SummaryTemplate', () => {
  // 假的 LlmProvider：把固定结果交给调用方给出的 schema 校验，模拟 generateObject
  function fakeLlm(output: unknown): LlmProvider {
    return {
      id: 'fake',
      nameKey: 'fake',
      configSchema: z.unknown(),
      testConnection: async () => {},
      generateObject: async (request) => request.schema.parse(output),
    }
  }
  const ctx = { signal: new AbortController().signal, onProgress: () => {} }

  const summary: Summary = {
    keywords: ['评审'],
    overview: '讨论了需求',
    chapters: [{ startMs: 0, title: '开场', summary: '介绍背景' }],
    speakerSummaries: [],
    keyPoints: ['范围确定'],
    actionItems: [{ text: '出设计稿', owner: '小王' }],
  }

  it('general template drives generateObject with its output schema', async () => {
    const t = generalSummaryTemplate
    const result = await fakeLlm(summary).generateObject(
      { system: t.systemPrompt('zh-CN'), prompt: '逐字稿', schema: t.outputSchema },
      {},
      ctx,
    )
    expectTypeOf(result).toEqualTypeOf<Summary>()
    expect(result).toEqual(summary)
    await expect(
      fakeLlm({ overview: 1 }).generateObject(
        { system: '', prompt: '', schema: t.outputSchema },
        {},
        ctx,
      ),
    ).rejects.toThrow()
    expect(t.systemPrompt('en')).not.toBe(t.systemPrompt('zh-CN'))
  })

  it('registers the built-in general template on import', () => {
    expect(registries.summaryTemplate.get('general')).toBe(generalSummaryTemplate)
    expect(() => registries.summaryTemplate.register(generalSummaryTemplate)).toThrow(/已注册/)
  })

  it('supports templates with a different output structure', async () => {
    const decisions = defineSummaryTemplate({
      id: 'decisions',
      nameKey: 'decisions',
      systemPrompt: () => '列出会议决策',
      outputSchema: z.object({ decisions: z.array(z.string()) }),
    })
    expectTypeOf<SummaryTemplateOutput<typeof decisions>>().toEqualTypeOf<{
      decisions: string[]
    }>()
    const result = await fakeLlm({ decisions: ['上线'] }).generateObject(
      { system: '', prompt: '', schema: decisions.outputSchema },
      {},
      ctx,
    )
    expect(result.decisions).toEqual(['上线'])

    registries.summaryTemplate.register(decisions)
    expect(registries.summaryTemplate.list().map((t) => t.id)).toEqual(['general', 'decisions'])
    expect(
      registries.summaryTemplate.get('decisions').outputSchema.parse({ decisions: [] }),
    ).toEqual({
      decisions: [],
    })
  })
})
