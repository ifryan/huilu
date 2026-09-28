import { expect, it } from 'vitest'
import { Meeting } from '@huilu/core'
import { txtExporter, srtExporter, markdownExporter } from './index'
import { mediaExporter } from './media'

const meeting = Meeting.parse({
  schemaVersion: 1,
  id: 'a',
  title: 'Title',
  createdAt: '2026-09-28T00:00:00Z',
  durationMs: 3601500,
  mode: 'audio',
  language: 'en',
  status: 'ready',
  speakers: [{ id: '0', name: 'Alicia' }],
  speakerAliases: { '1': '0' },
})
const transcript = {
  language: 'en',
  segments: [{ startMs: 3599999, endMs: 3601500, speakerId: '1', text: 'Hello <world>' }],
}
it('exports UTF-8 text with edited names and absolute timestamps', async () => {
  const text = await (await txtExporter.export({ meeting, transcript })).text()
  expect(text).toContain('[00:59:59] Alicia: Hello <world>')
})
it('writes SRT with millisecond timestamps and valid numbering', async () => {
  const text = await (await srtExporter.export({ meeting, transcript })).text()
  expect(text).toBe('1\r\n00:59:59,999 --> 01:00:01,500\r\nAlicia: Hello <world>\r\n')
})
it('exports merged speaker summaries and action metadata as Markdown', async () => {
  const summary = {
    keywords: ['test'],
    overview: 'Overview',
    chapters: [],
    speakerSummaries: [{ speakerId: '1', summary: 'Discussed' }],
    keyPoints: [],
    actionItems: [{ text: 'Ship', owner: 'Team', due: 'Friday' }],
  }
  const text = await (await markdownExporter.export({ meeting, summary })).text()
  expect(text).toContain('**Alicia**: Discussed')
  expect(text).toContain('- [ ] Ship · Team · Friday')
})
it('rejects missing text and counterfeit MP4 rather than changing extensions', async () => {
  await expect(txtExporter.export({ meeting })).rejects.toThrow('noTranscript')
  await expect(markdownExporter.export({ meeting })).rejects.toThrow('noSummary')
  await expect(
    mediaExporter('mp4', async () => new Blob(['not a video'], { type: 'video/mp4' })).export({
      meeting,
    }),
  ).rejects.toThrow()
})
