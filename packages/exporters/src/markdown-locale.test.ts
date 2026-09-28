import { expect, it } from 'vitest'
import { Meeting } from '@huilu/core'
import { markdownExporter } from './index'

it.each([
  { language: 'auto', text: '我们今天讨论一下产品计划', heading: '全文概要' },
  { language: 'auto', text: 'We discussed the product plan', heading: 'Overview' },
  { language: 'en', text: '我们今天讨论一下产品计划', heading: 'Overview' },
  { language: 'zh-CN', text: 'We discussed the product plan', heading: '全文概要' },
])(
  'uses the summary generation locale for $language / $text',
  async ({ language, text, heading }) => {
    const meeting = Meeting.parse({
      schemaVersion: 1,
      id: 'locale',
      title: 'Locale',
      createdAt: '2026-09-28T00:00:00Z',
      durationMs: 1000,
      mode: 'audio',
      language,
      status: 'ready',
    })
    const transcript = {
      language: 'auto',
      segments: [{ startMs: 0, endMs: 1000, speakerId: '0', text }],
    }
    const summary = {
      keywords: [],
      overview: text,
      chapters: [],
      speakerSummaries: [],
      keyPoints: [],
      actionItems: [],
    }
    expect(
      await (await markdownExporter.export({ meeting, transcript, summary })).text(),
    ).toContain(`## ${heading}\n`)
  },
)
