import type { Meeting } from './schema/meeting'
import type { Transcript } from './schema/transcript'
import type { Summary } from './schema/summary'

/** Original segment IDs stay intact; one atomic metadata edit controls every consumer. */
export function resolveSpeaker(meeting: Meeting, id: string): string {
  const seen = new Set<string>()
  while (
    meeting.speakerAliases &&
    Object.hasOwn(meeting.speakerAliases, id) &&
    meeting.speakerAliases[id] &&
    !seen.has(id)
  ) {
    seen.add(id)
    id = meeting.speakerAliases[id]!
  }
  return id
}

export function mappedTranscript(meeting: Meeting, transcript: Transcript): Transcript {
  return {
    ...transcript,
    segments: transcript.segments.map((s) => ({
      ...s,
      speakerId: resolveSpeaker(meeting, s.speakerId),
    })),
  }
}

export function mappedSummary(meeting: Meeting, summary: Summary): Summary {
  const groups = new Map<string, string[]>()
  for (const item of summary.speakerSummaries) {
    const id = resolveSpeaker(meeting, item.speakerId)
    groups.set(id, [...(groups.get(id) ?? []), item.summary])
  }
  return {
    ...summary,
    speakerSummaries: [...groups].map(([speakerId, texts]) => ({
      speakerId,
      summary: texts.join('\n\n'),
    })),
  }
}
