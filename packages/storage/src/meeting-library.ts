import {
  Meeting,
  migrateMeeting,
  Transcript,
  Summary,
  resolveSpeaker,
  type StorageAdapter,
} from '@huilu/core'

export interface MeetingEntry {
  key: string
  dir: string
  meeting?: Meeting
  issue?: 'damaged' | 'duplicate'
}
export interface MeetingDocument {
  meeting: Meeting
  transcript?: Transcript
  summary?: Summary
  warnings: ('transcript' | 'summary')[]
}

export async function scanMeetings(adapter: StorageAdapter): Promise<MeetingEntry[]> {
  const entries: MeetingEntry[] = []
  const ids = new Set<string>()
  for (const dir of await adapter.listMeetingDirs()) {
    try {
      const blob = await adapter.readFile(`${dir}/meeting.json`)
      const meeting = migrateMeeting(JSON.parse(await blob!.text()))
      const duplicate = ids.has(meeting.id)
      if (duplicate) {
        const previous = entries.find((entry) => entry.meeting?.id === meeting.id)
        if (previous) previous.issue = 'duplicate'
      }
      ids.add(meeting.id)
      entries.push({
        key: dir,
        dir,
        meeting,
        ...(duplicate ? { issue: 'duplicate' as const } : {}),
      })
    } catch (error) {
      // A revoked root cannot be mistaken for a successful empty rebuild.
      if (!(await adapter.isReady())) throw error
      entries.push({ key: dir, dir, issue: 'damaged' })
    }
  }
  return entries.sort((a, b) =>
    (b.meeting?.createdAt ?? '').localeCompare(a.meeting?.createdAt ?? ''),
  )
}

export async function readMeetingDocument(
  adapter: StorageAdapter,
  dir: string,
  id: string,
): Promise<MeetingDocument> {
  const blob = await adapter.readFile(`${dir}/meeting.json`)
  if (!blob) throw new Error('missingMeeting')
  const meeting = migrateMeeting(JSON.parse(await blob.text()))
  if (meeting.id !== id) throw new Error('foreignMeeting')
  const result: MeetingDocument = { meeting, warnings: [] }
  for (const kind of ['transcript', 'summary'] as const) {
    try {
      const file = await adapter.readFile(`${dir}/${kind}.json`)
      if (!file) continue
      const data: unknown = JSON.parse(await file.text())
      if (kind === 'transcript') {
        const transcript = Transcript.parse(data)
        if (
          transcript.segments.some(
            (s, i, a) => s.endMs < s.startMs || (i > 0 && s.startMs < a[i - 1]!.startMs),
          )
        )
          throw new Error('timeline')
        result.transcript = transcript
      } else result.summary = Summary.parse(data)
    } catch {
      result.warnings.push(kind)
    }
  }
  return result
}

export type MeetingEdit =
  | { type: 'title'; value: string; previous: string }
  | { type: 'favorite'; value: boolean }
  | { type: 'rename'; id: string; value: string; previous: string }
  | { type: 'merge'; from: string; into: string; revision: number }

export class EditConflictError extends Error {
  constructor() {
    super('editConflict')
  }
}

/** Shared with the pipeline writer, across tabs and the offscreen document. */
const localLocks = new Map<string, Promise<unknown>>()

export function withMeetingLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(`huilu:meeting:${id}`, action)
  if (typeof document !== 'undefined') return Promise.reject(new Error('locksUnavailable'))
  const run = (localLocks.get(id) ?? Promise.resolve()).then(action)
  const tail = run.catch(() => {})
  localLocks.set(id, tail)
  void tail.then(() => {
    if (localLocks.get(id) === tail) localLocks.delete(id)
  })
  return run
}

export async function editMeeting(
  adapter: StorageAdapter,
  dir: string,
  id: string,
  edit: MeetingEdit,
): Promise<Meeting> {
  return withMeetingLock(id, async () => {
    const path = `${dir}/meeting.json`
    const file = await adapter.readFile(path)
    if (!file) throw new Error('missingMeeting')
    const before = await file.text()
    const raw = JSON.parse(before) as Record<string, unknown>
    const meeting = migrateMeeting(raw)
    if (meeting.id !== id) throw new Error('foreignMeeting')
    if (edit.type === 'title') {
      if (meeting.title !== edit.previous) throw new EditConflictError()
      if (!edit.value.trim()) throw new Error('emptyTitle')
      meeting.title = edit.value.trim()
    } else if (edit.type === 'favorite') meeting.favorite = edit.value
    else if (edit.type === 'rename') {
      const speaker = meeting.speakers.find((s) => s.id === edit.id)
      if (
        !speaker ||
        speaker.name !== edit.previous ||
        resolveSpeaker(meeting, edit.id) !== edit.id
      )
        throw new EditConflictError()
      if (!edit.value.trim()) throw new Error('emptyName')
      speaker.name = edit.value.trim()
    } else {
      if ((meeting.editRevision ?? 0) !== edit.revision || edit.from === edit.into)
        throw new EditConflictError()
      if (
        ![edit.from, edit.into].every(
          (id) => meeting.speakers.some((s) => s.id === id) && resolveSpeaker(meeting, id) === id,
        )
      )
        throw new EditConflictError()
      meeting.speakerAliases = { ...meeting.speakerAliases, [edit.from]: edit.into }
    }
    meeting.editRevision = (meeting.editRevision ?? 0) + 1
    const content = JSON.stringify({ ...raw, ...Meeting.parse(meeting) }, null, 2)
    // Detect outside editors before creating the atomic writable replacement.
    if ((await (await adapter.readFile(path))?.text()) !== before) throw new EditConflictError()
    await adapter.writeFile(path, content)
    if ((await (await adapter.readFile(path))?.text()) !== content) throw new Error('writeFailed')
    return meeting
  })
}
