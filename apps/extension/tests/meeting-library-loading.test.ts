import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Meeting } from '@huilu/core'
import { IdbJobStore } from '@huilu/pipeline/jobs'
import {
  IdbHandleStore,
  LocalFolderStorageAdapter,
  MeetingIndex,
  type IndexSnapshot,
} from '@huilu/storage'
import { MemoryDirectoryHandle } from '../../../packages/storage/src/memory-fs.test-helper'
import { loadLibrary, loadResult, saveLibraryEdit } from '@/lib/meeting-library'

vi.hoisted(() => vi.stubGlobal('indexedDB', {}))
vi.mock('@/lib/library', () => ({
  listRecordings: vi.fn(async () => []),
  recordingManifest: vi.fn(async () => undefined),
}))

let root: MemoryDirectoryHandle
let folder: LocalFolderStorageAdapter
const meeting = Meeting.parse({
  schemaVersion: 1,
  id: 'a',
  title: 'Authoritative meeting',
  createdAt: '2026-09-28T00:00:00Z',
  durationMs: 1000,
  mode: 'audio',
  language: 'en',
  status: 'ready',
})
beforeEach(async () => {
  root = Object.assign(new MemoryDirectoryHandle('root'), {
    async isSameEntry(other: unknown) {
      if (!(other instanceof MemoryDirectoryHandle)) throw new TypeError('Invalid directory handle')
      return root === other
    },
  })
  folder = LocalFolderStorageAdapter.forHandle(root.asFolder())
  await folder.writeFile('first/meeting.json', JSON.stringify(meeting))
  vi.spyOn(IdbHandleStore.prototype, 'get').mockResolvedValue(root.asFolder())
  vi.spyOn(MeetingIndex.prototype, 'read').mockResolvedValue(undefined)
  vi.spyOn(MeetingIndex.prototype, 'replace').mockResolvedValue()
  vi.spyOn(IdbJobStore.prototype, 'get').mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it('rejects duplicate IDs on direct result loading without selecting an arbitrary folder', async () => {
  await folder.writeFile(
    'second/meeting.json',
    JSON.stringify({ ...meeting, title: 'Other meeting' }),
  )
  expect((await loadLibrary()).items.every((item) => item.folder?.issue === 'duplicate')).toBe(true)
  await expect(loadResult('a')).rejects.toThrow('duplicateMeeting')
})
it.each([undefined, {}, { kind: 'directory' }])(
  'rebuilds when cached root is invalid: %s',
  async (cachedRoot) => {
    vi.mocked(MeetingIndex.prototype.read).mockResolvedValue({
      root: cachedRoot,
      entries: [],
    } as unknown as IndexSnapshot)
    expect((await loadLibrary()).items[0]?.title).toBe('Authoritative meeting')
    expect(MeetingIndex.prototype.replace).toHaveBeenCalled()
  },
)
it.each(
  [null, 'stale schema', [null], [{ key: 'bad', dir: 'bad', meeting: { id: 'a' } }]].map(
    (entries) => ({ entries }),
  ),
)('ignores malformed cached entries: %s', async ({ entries }) => {
  vi.mocked(MeetingIndex.prototype.read).mockResolvedValue({
    root: root.asFolder(),
    entries,
  } as unknown as IndexSnapshot)
  root.permission = 'denied'
  const library = await loadLibrary()
  expect(library.folderUnavailable).toBe(true)
  expect(library.items).toEqual([])
})

it('retains validated cached meeting titles when access is lost', async () => {
  vi.mocked(MeetingIndex.prototype.read).mockResolvedValue({
    root: root.asFolder(),
    entries: [{ key: 'first', dir: 'first', meeting }],
  })
  root.permission = 'denied'
  const library = await loadLibrary()
  expect(library.folderUnavailable).toBe(true)
  expect(library.items[0]).toMatchObject({ title: 'Authoritative meeting', available: false })
})

it('persists title and archive edits in folder source across rebuilds and direct results', async () => {
  const item = (await loadLibrary()).items[0]!
  await saveLibraryEdit(item, { type: 'title', previous: item.title, value: 'Renamed in history' })
  const fresh = (await loadLibrary()).items[0]!
  expect(fresh.title).toBe('Renamed in history')
  await saveLibraryEdit(fresh, { type: 'archive', previous: false, value: true })
  expect((await loadLibrary()).items[0]?.archived).toBe(true)
  expect((await loadResult('a')).meeting).toMatchObject({
    title: 'Renamed in history',
    archived: true,
  })
  await saveLibraryEdit((await loadLibrary()).items[0]!, {
    type: 'archive',
    previous: true,
    value: false,
  })
  expect((await loadLibrary()).items[0]?.archived).toBe(false)
})
it.each(['queued', 'running', 'waitingFolder'] as const)(
  'blocks history edits during %s without changing disk',
  async (state) => {
    const item = (await loadLibrary()).items[0]!
    vi.mocked(IdbJobStore.prototype.get).mockResolvedValue({
      meetingId: 'a',
      state,
      checkpoints: {},
      attempts: 1,
      createdAt: 0,
      updatedAt: 0,
    })
    await expect(
      saveLibraryEdit(item, { type: 'archive', previous: false, value: true }),
    ).rejects.toThrow('meetingBusy')
    expect((await loadResult('a')).meeting.archived).toBeUndefined()
  },
)
it('refuses stale permissions and folder changes rather than writing to the new folder', async () => {
  const item = (await loadLibrary()).items[0]!
  root.permission = 'denied'
  await expect(
    saveLibraryEdit(item, { type: 'archive', previous: false, value: true }),
  ).rejects.toThrow()
  root.permission = 'granted'
  const another = new MemoryDirectoryHandle('other')
  Object.assign(another, { isSameEntry: async (other: unknown) => other === another })
  const otherFolder = LocalFolderStorageAdapter.forHandle(another.asFolder())
  await otherFolder.writeFile('first/meeting.json', JSON.stringify(meeting))
  vi.mocked(IdbHandleStore.prototype.get).mockResolvedValue(another.asFolder())
  await expect(
    saveLibraryEdit(item, { type: 'title', previous: item.title, value: 'Wrong root' }),
  ).rejects.toThrow('folderChanged')
  expect(JSON.parse(await (await otherFolder.readFile('first/meeting.json'))!.text()).title).toBe(
    meeting.title,
  )
})
