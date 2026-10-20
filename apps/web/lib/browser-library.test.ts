import { beforeEach, expect, it, vi } from 'vitest'
import { RecorderController, RecordingStore } from '@huilu/recorder'
import { IdbJobStore } from '@huilu/pipeline/jobs'
import { IdbHandleStore, MeetingIndex, OpfsStorageAdapter } from '@huilu/storage'
import { FakeMedia, MemoryFs } from '../../../packages/recorder/src/test-helpers'
const h = vi.hoisted(() => {
  vi.stubGlobal('indexedDB', {})
  return { root: undefined as (() => Promise<FileSystemDirectoryHandle>) | undefined }
})
vi.mock('@/platform/storage', async () => {
  const { OpfsStorageAdapter } = await import('@huilu/storage')
  return {
    localResults: true,
    opfs: new OpfsStorageAdapter({ base: 'recordings', getRoot: () => h.root!() }),
  }
})
vi.mock('@/lib/settings', () => ({ dataFolderAuthorizedSetting: { watch: () => () => {} } }))
import {
  loadLibrary,
  loadResult,
  saveResultEdit,
  saveLibraryEdit,
} from '@huilu/app-shell/lib/meeting-library'
let id: string
beforeEach(async () => {
  vi.restoreAllMocks()
  const fs = new MemoryFs()
  h.root = fs.provider
  vi.stubGlobal('navigator', { storage: { getDirectory: fs.provider } })
  vi.spyOn(IdbHandleStore.prototype, 'get').mockResolvedValue(undefined)
  vi.spyOn(MeetingIndex.prototype, 'read').mockResolvedValue(undefined)
  const media = new FakeMedia()
  const controller = new RecorderController({ store: new RecordingStore(fs.provider), media })
  const status = await controller.start({
    id: 'browser-local',
    title: 'Browser meeting',
    mode: 'audio',
    source: 'tab',
    streamId: '',
    sourceAudio: true,
    quality: { resolution: '720p', fps: 15 },
    microphone: { enabled: false },
    language: 'en',
  })
  id = status.session!.id
  media.recorders[0]!.emit('audio')
  await controller.stop()
  vi.spyOn(IdbJobStore.prototype, 'get').mockResolvedValue({
    meetingId: id,
    state: 'done',
    folderCommitted: true,
    folderDir: id,
    checkpoints: {},
    createdAt: 0,
    updatedAt: 0,
    attempts: 1,
  })
})
it('reads completed OPFS results without an external folder handle and keeps edits writable', async () => {
  const doc = await loadResult(id)
  expect(doc.source).toBe('local')
  expect(doc.readOnly).toBe(false)
  await saveResultEdit(doc, { type: 'title', value: 'Edited', previous: 'Browser meeting' })
  expect((await loadResult(id)).meeting.title).toBe('Edited')
  const library = await loadLibrary()
  await saveLibraryEdit(library.items[0]!, { type: 'archive', value: true, previous: false })
  expect((await loadLibrary()).items[0]?.archived).toBe(true)
})
it('refuses edits while browser-only results are still processing', async () => {
  vi.mocked(IdbJobStore.prototype.get).mockResolvedValue({
    meetingId: id,
    state: 'running',
    checkpoints: {},
    createdAt: 0,
    updatedAt: 0,
    attempts: 1,
  })
  await expect(
    saveResultEdit(await loadResult(id), { type: 'favorite', value: true }),
  ).rejects.toThrow('meetingBusy')
  // The adapter still reads real recording metadata from the same OPFS directory.
  expect(
    await new OpfsStorageAdapter({ base: 'recordings', getRoot: h.root }).readFile(
      `${id}/meeting.json`,
    ),
  ).toBeDefined()
})
