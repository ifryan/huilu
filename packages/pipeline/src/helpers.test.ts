import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { meetingFolderName } from './folder'
import { IdbJobStore, type ProcessingJob } from './jobs'
import { planCuts } from './split'
import { renderSummaryMarkdown } from './summary'
import { mergeTranscripts, speakersFromTranscript, summaryLocale } from './transcript'

describe('planCuts', () => {
  it('keeps small files whole', async () => {
    expect(await planCuts(100, 60, 200, async () => 0)).toEqual([0, 60])
  })

  it('cuts at the quietest point before each ideal position, with a 10% margin', async () => {
    const windows: [number, number][] = []
    // 40 分钟 7.6MB，按 2MB 切（ADR 0004 的实测参数）
    const cuts = await planCuts(7.6e6, 2400, 2e6, async (from, to) => {
      windows.push([from, to])
      return to - 5
    })
    const pieceS = (2400 * 2e6 * 0.9) / 7.6e6
    expect(windows[0]).toEqual([pieceS - 20, pieceS])
    expect(cuts[0]).toBe(0)
    expect(cuts.at(-1)).toBe(2400)
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]! - cuts[i - 1]!).toBeLessThanOrEqual(pieceS + 1e-9)
      expect(cuts[i]!).toBeGreaterThan(cuts[i - 1]!)
    }
  })

  it('falls back to the ideal point when the search returns nonsense', async () => {
    const cuts = await planCuts(300, 30, 100, async () => Number.NaN)
    expect(cuts).toEqual([0, 9, 18, 27, 30])
  })
})

describe('meetingFolderName', () => {
  it('uses the local date, time and a file-system safe title', () => {
    const createdAt = new Date(2026, 8, 24, 14, 30).toISOString()
    expect(meetingFolderName({ id: 'x', title: '需求评审', createdAt })).toBe(
      '2026-09-24_1430_需求评审',
    )
    expect(meetingFolderName({ id: 'x', title: 'a/b:c*?"<>|  d. ', createdAt })).toBe(
      '2026-09-24_1430_a b c d',
    )
    expect(meetingFolderName({ id: 'm-1', title: ' ../ ', createdAt })).toBe('2026-09-24_1430_m-1')
  })
})

describe('transcript helpers', () => {
  const t = (text: string) => ({
    language: 'x',
    segments: [{ startMs: 0, endMs: 1, speakerId: '0', text }],
  })

  it('picks the summary language from the meeting language or the transcript', () => {
    expect(summaryLocale('zh')).toBe('zh-CN')
    expect(summaryLocale('zh-en')).toBe('zh-CN')
    expect(summaryLocale('en')).toBe('en')
    expect(summaryLocale('auto', t('我们今天讨论一下 roadmap'))).toBe('zh-CN')
    expect(summaryLocale('auto', t('Let us talk about the roadmap today'))).toBe('en')
  })

  it('numbers speakers by first appearance', () => {
    const transcript = {
      language: 'zh',
      segments: ['2', '0', '2'].map((speakerId) => ({
        startMs: 0,
        endMs: 1,
        speakerId,
        text: 'x',
      })),
    }
    expect(speakersFromTranscript(transcript, 'en')).toEqual([
      { id: '2', name: 'Speaker 1' },
      { id: '0', name: 'Speaker 2' },
    ])
  })

  it('merges pieces in timeline order', () => {
    const merged = mergeTranscripts(
      [
        { transcript: t('b'), offsetMs: 5000 },
        { transcript: t('a'), offsetMs: 0 },
      ],
      'zh',
    )
    expect(merged.segments.map((s) => [s.startMs, s.text])).toEqual([
      [0, 'a'],
      [5000, 'b'],
    ])
  })

  it('renders English markdown with empty sections marked', () => {
    const md = renderSummaryMarkdown(
      { title: 'Weekly', createdAt: new Date(2026, 0, 2, 3, 4).toISOString(), durationMs: 61_000 },
      {
        keywords: [],
        overview: 'Short',
        chapters: [{ startMs: 61_000, title: 'Wrap-up', summary: '' }],
        speakerSummaries: [],
        keyPoints: [],
        actionItems: [{ text: 'Ship it', owner: 'Ann' }],
      },
      [],
      'en',
    )
    expect(md).toContain('> Date: 2026-01-02 03:04 · Duration: 01:01')
    expect(md).toContain('`01:01` **Wrap-up**')
    expect(md).toContain('- [ ] Ship it (Owner: Ann)')
    expect(md).toContain('## Key points\n\n- None')
  })
})

describe('IdbJobStore', () => {
  it('persists jobs across instances and keeps write order', async () => {
    const idb = new IDBFactory()
    const store = new IdbJobStore(idb)
    const job: ProcessingJob = {
      meetingId: 'm1',
      state: 'queued',
      attempts: 0,
      checkpoints: { 'transcribe:x': { taskId: 't' } },
      createdAt: 1,
      updatedAt: 1,
    }
    const writes = [1, 2, 3].map((progress) => store.put({ ...job, state: 'running', progress }))
    await Promise.all(writes)
    const reopened = new IdbJobStore(idb)
    expect(await reopened.get('m1')).toMatchObject({ state: 'running', progress: 3 })
    expect(await reopened.list()).toHaveLength(1)
    await reopened.delete('m1')
    expect(await store.get('m1')).toBeUndefined()
  })
})
