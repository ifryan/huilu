import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { Meeting, mappedTranscript, mappedSummary } from '@huilu/core'
import { OpfsStorageAdapter } from './opfs'
import { MemoryDirectoryHandle } from './memory-fs.test-helper'
import { editMeeting, readMeetingDocument, scanMeetings, withMeetingLock } from './meeting-library'
import { MeetingIndex } from './meeting-index'

const meeting = Meeting.parse({
  schemaVersion: 1,
  id: 'a',
  title: 'Original',
  createdAt: '2026-09-28T00:00:00Z',
  durationMs: 2000,
  mode: 'audio',
  language: 'en',
  status: 'ready',
  speakers: [
    { id: '0', name: 'Alice' },
    { id: '1', name: 'Bob' },
  ],
})
async function fixture() {
  const root = new MemoryDirectoryHandle('')
  const store = new OpfsStorageAdapter({
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
  })
  await store.writeFile('a/meeting.json', JSON.stringify({ ...meeting, futureField: 'preserve' }))
  return store
}
describe('folder authority and atomic metadata editing', () => {
  it('scans, reads, and edits legacy meetings without schemaVersion', async () => {
    const store = await fixture()
    const legacy: Record<string, unknown> = { ...meeting, futureField: 'preserve' }
    delete legacy.schemaVersion
    await store.writeFile('a/meeting.json', JSON.stringify(legacy))
    expect((await scanMeetings(store))[0]).toMatchObject({ meeting: { id: 'a', schemaVersion: 1 } })
    expect((await readMeetingDocument(store, 'a', 'a')).meeting.title).toBe('Original')
    await editMeeting(store, 'a', 'a', { type: 'title', previous: 'Original', value: 'Migrated' })
    expect(JSON.parse(await (await store.readFile('a/meeting.json'))!.text())).toMatchObject({
      schemaVersion: 1,
      title: 'Migrated',
      futureField: 'preserve',
      editRevision: 1,
    })
    expect((await readMeetingDocument(store, 'a', 'a')).meeting.title).toBe('Migrated')
  })
  it.each([null, 0, '1', 2])(
    'rejects unsupported or invalid schemaVersion %s without writing',
    async (schemaVersion) => {
      const store = await fixture()
      const before = JSON.stringify({ ...meeting, schemaVersion })
      await store.writeFile('a/meeting.json', before)
      expect((await scanMeetings(store))[0]?.issue).toBe('damaged')
      await expect(readMeetingDocument(store, 'a', 'a')).rejects.toThrow()
      await expect(
        editMeeting(store, 'a', 'a', { type: 'title', previous: 'Original', value: 'Invalid' }),
      ).rejects.toThrow()
      expect(await (await store.readFile('a/meeting.json'))!.text()).toBe(before)
    },
  )
  it('rejects malformed legacy data rather than repairing missing required fields', async () => {
    const store = await fixture()
    await store.writeFile('a/meeting.json', JSON.stringify({ id: 'a' }))
    expect((await scanMeetings(store))[0]?.issue).toBe('damaged')
    await expect(readMeetingDocument(store, 'a', 'a')).rejects.toThrow()
    await expect(editMeeting(store, 'a', 'a', { type: 'favorite', value: true })).rejects.toThrow()
  })
  it('isolates damaged records and rebuilds the disposable index from current files', async () => {
    const store = await fixture()
    await store.writeFile('bad/meeting.json', '{')
    await editMeeting(store, 'a', 'a', { type: 'title', previous: 'Original', value: 'Edited' })
    const entries = await scanMeetings(store)
    expect(entries.find((e) => e.dir === 'bad')?.issue).toBe('damaged')
    expect(entries.find((e) => e.dir === 'a')?.meeting?.title).toBe('Edited')
    const index = new MeetingIndex()
    await index.replace({ entries, root: {} as FileSystemDirectoryHandle })
    await index.clear()
    expect(await index.read()).toBeUndefined()
    await index.replace({
      entries: await scanMeetings(store),
      root: {} as FileSystemDirectoryHandle,
    })
    expect((await index.read())?.entries).toEqual(entries)
  })
  it('keeps valid media metadata when transcript is corrupt', async () => {
    const store = await fixture()
    await store.writeFile('a/transcript.json', '{')
    const doc = await readMeetingDocument(store, 'a', 'a')
    expect(doc.meeting.title).toBe('Original')
    expect(doc.warnings).toEqual(['transcript'])
    await expect(readMeetingDocument(store, 'a', 'foreign')).rejects.toThrow('foreignMeeting')
  })
  it('serializes independent edits, rejects stale field writes, and preserves unknown fields', async () => {
    const store = await fixture()
    await Promise.all([
      editMeeting(store, 'a', 'a', { type: 'title', previous: 'Original', value: 'New' }),
      editMeeting(store, 'a', 'a', { type: 'rename', id: '0', previous: 'Alice', value: 'Alicia' }),
    ])
    const saved = await readMeetingDocument(store, 'a', 'a')
    expect(saved.meeting.title).toBe('New')
    expect(saved.meeting.speakers[0]?.name).toBe('Alicia')
    expect(JSON.parse(await (await store.readFile('a/meeting.json'))!.text()).futureField).toBe(
      'preserve',
    )
    await expect(
      editMeeting(store, 'a', 'a', { type: 'title', previous: 'Original', value: 'Stale' }),
    ).rejects.toThrow('editConflict')
  })
  it('merges the same IDs across transcript and guide without destroying original segments', async () => {
    const store = await fixture()
    const transcript = {
      language: 'en',
      segments: [{ startMs: 0, endMs: 1000, speakerId: '1', text: 'Hello' }],
    }
    await store.writeFile('a/transcript.json', JSON.stringify(transcript))
    const merged = await editMeeting(store, 'a', 'a', {
      type: 'merge',
      from: '1',
      into: '0',
      revision: 0,
    })
    expect(mappedTranscript(merged, transcript).segments[0]?.speakerId).toBe('0')
    const summary = {
      keywords: [],
      overview: '',
      chapters: [],
      keyPoints: [],
      actionItems: [],
      speakerSummaries: [
        { speakerId: '0', summary: 'One' },
        { speakerId: '1', summary: 'Two' },
      ],
    }
    expect(mappedSummary(merged, summary).speakerSummaries).toEqual([
      { speakerId: '0', summary: 'One\n\nTwo' },
    ])
    expect(JSON.parse(await (await store.readFile('a/transcript.json'))!.text())).toEqual(
      transcript,
    )
    await expect(
      editMeeting(store, 'a', 'a', { type: 'merge', from: '0', into: '1', revision: 1 }),
    ).rejects.toThrow('editConflict')
  })
  it('waits for a concurrent pipeline write before validating an edit', async () => {
    const store = await fixture()
    const pipeline = withMeetingLock('a', async () => {
      await new Promise((r) => setTimeout(r, 10))
      await store.writeFile('a/meeting.json', JSON.stringify({ ...meeting, title: 'Pipeline' }))
    })
    const edit = editMeeting(store, 'a', 'a', {
      type: 'title',
      previous: 'Original',
      value: 'Stale',
    })
    await expect(edit).rejects.toThrow('editConflict')
    await pipeline
  })
})

it('isolates a meeting.json directory and disables ambiguous duplicate IDs', async () => {
  const store = await fixture()
  await store.writeFile('wrong/meeting.json/nested.txt', 'retained')
  await store.writeFile('copy/meeting.json', JSON.stringify(meeting))
  const entries = await scanMeetings(store)
  expect(entries.find((e) => e.dir === 'wrong')?.issue).toBe('damaged')
  expect(entries.filter((e) => e.meeting?.id === 'a').every((e) => e.issue === 'duplicate')).toBe(
    true,
  )
  expect(await (await store.readFile('wrong/meeting.json/nested.txt'))!.text()).toBe('retained')
})
