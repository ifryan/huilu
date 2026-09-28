import { describe, expect, it } from 'vitest'
import { Meeting } from './schema/meeting'
import { mappedSummary, mappedTranscript, resolveSpeaker } from './speakers'

const meeting = () =>
  Meeting.parse({
    schemaVersion: 1,
    id: 'imported',
    title: 'Imported',
    createdAt: '2026-09-28T00:00:00Z',
    durationMs: 1000,
    mode: 'audio',
    language: 'en',
    status: 'ready',
    speakerAliases: { B: 'A' },
  })

describe('speaker alias ownership', () => {
  it.each(['toString', 'constructor', '__proto__'])(
    'keeps unaliased speaker %s as a string',
    (id) => {
      const doc = meeting()
      expect(resolveSpeaker(doc, id)).toBe(id)
      expect(
        mappedTranscript(doc, {
          language: 'en',
          segments: [{ startMs: 0, endMs: 1000, speakerId: id, text: 'Hello' }],
        }).segments[0]?.speakerId,
      ).toBe(id)
      expect(
        mappedSummary(doc, {
          keywords: [],
          overview: '',
          chapters: [],
          keyPoints: [],
          actionItems: [],
          speakerSummaries: [{ speakerId: id, summary: 'Hello' }],
        }).speakerSummaries[0]?.speakerId,
      ).toBe(id)
    },
  )
  it('supports explicit aliases with prototype-like names and alias chains', () => {
    const doc = meeting()
    doc.speakerAliases = JSON.parse(
      '{"__proto__":"constructor","constructor":"toString","toString":"A"}',
    )
    expect(resolveSpeaker(doc, '__proto__')).toBe('A')
  })
  it('terminates cycles while returning a string speaker ID', () => {
    const doc = meeting()
    doc.speakerAliases = { A: 'B', B: 'A' }
    expect(resolveSpeaker(doc, 'A')).toBe('A')
  })
})
