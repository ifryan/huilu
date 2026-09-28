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
import { loadLibrary, loadResult } from '@/lib/meeting-library'

vi.hoisted(() => vi.stubGlobal('indexedDB', {}))
vi.mock('@/lib/library', () => ({ listRecordings: vi.fn(async () => []) }))

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
