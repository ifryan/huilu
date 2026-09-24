import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  FolderNotReadyError,
  IdbHandleStore,
  InvalidPathError,
  LocalFolderStorageAdapter,
  OpfsStorageAdapter,
  WriteVerificationError,
  splitPath,
  type FolderHandle,
  type HandleStore,
} from './index'
import { MemoryDirectoryHandle } from './memory-fs.test-helper'

class MemoryHandleStore implements HandleStore {
  handle: FolderHandle | undefined
  async get() {
    return this.handle
  }
  async set(handle: FolderHandle) {
    this.handle = handle
  }
  async clear() {
    this.handle = undefined
  }
}

function opfs(base?: string) {
  const root = new MemoryDirectoryHandle('')
  const adapter = new OpfsStorageAdapter({
    base,
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
  })
  return { root, adapter }
}

function localFolder() {
  const folder = new MemoryDirectoryHandle('HuiLu')
  const store = new MemoryHandleStore()
  let pickResult: FolderHandle | DOMException = folder.asFolder()
  const adapter = new LocalFolderStorageAdapter(store, async () => {
    if (pickResult instanceof DOMException) throw pickResult
    return pickResult
  })
  return {
    folder,
    store,
    adapter,
    cancelNextPick: () => (pickResult = new DOMException('cancelled', 'AbortError')),
  }
}

const text = async (blob: Blob | undefined) => blob?.text()

describe('splitPath', () => {
  it('splits and normalizes separators', () => {
    expect(splitPath('a/b\\c.json')).toEqual(['a', 'b', 'c.json'])
    expect(splitPath('/a//b/')).toEqual(['a', 'b'])
  })

  it.each(['', '/', '../x', 'a/./b', 'a/../../b'])('rejects %j', (p) => {
    expect(() => splitPath(p)).toThrow(InvalidPathError)
  })
})

describe('DirectoryStorageAdapter (via OPFS)', () => {
  it('writes and reads files, creating parent folders', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('2026-09-24_1430_评审/meeting.json', '{"id":"m1"}')
    expect(await text(await adapter.readFile('2026-09-24_1430_评审/meeting.json'))).toBe(
      '{"id":"m1"}',
    )
  })

  it('returns undefined for missing files', async () => {
    const { adapter } = opfs()
    expect(await adapter.readFile('nope/meeting.json')).toBeUndefined()
  })

  it('overwrites instead of appending on writeFile', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('a.txt', 'long content')
    await adapter.writeFile('a.txt', 'short')
    expect(await text(await adapter.readFile('a.txt'))).toBe('short')
  })

  it('appends chunks in order', async () => {
    const { adapter } = opfs()
    await adapter.appendFile('rec/audio.webm', new Blob(['aa']))
    await adapter.appendFile('rec/audio.webm', new Blob(['bbb']))
    expect(await text(await adapter.readFile('rec/audio.webm'))).toBe('aabbb')
  })

  it('verifies size after write and throws when the file silently ends up empty', async () => {
    const { root, adapter } = opfs()
    root.fs.silentWriteFailure = true
    const err = await adapter.writeFile('rec/0001.part', new Blob(['12345'])).catch((e) => e)
    expect(err).toBeInstanceOf(WriteVerificationError)
    expect(err).toMatchObject({ path: 'rec/0001.part', expectedBytes: 5, actualBytes: 0 })
    await expect(adapter.appendFile('rec/audio.webm', new Blob(['x']))).rejects.toBeInstanceOf(
      WriteVerificationError,
    )
  })

  it('lists only folders that contain meeting.json, newest first', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('2026-09-23_0900_a/meeting.json', '{}')
    await adapter.writeFile('2026-09-24_1430_b/meeting.json', '{}')
    await adapter.writeFile('random/notes.md', 'x')
    await adapter.writeFile('loose.txt', 'x')
    expect(await adapter.listMeetingDirs()).toEqual(['2026-09-24_1430_b', '2026-09-23_0900_a'])
  })

  it('removes files and folders recursively; missing paths are ignored', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('m1/meeting.json', '{}')
    await adapter.writeFile('m1/frames/1.jpg', 'x')
    await adapter.remove('m1')
    expect(await adapter.readFile('m1/meeting.json')).toBeUndefined()
    await expect(adapter.remove('m1')).resolves.toBeUndefined()
  })

  it('computes usage recursively', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('m1/meeting.json', '1234')
    await adapter.writeFile('m1/frames/1.jpg', '123456')
    await adapter.writeFile('m2/meeting.json', '12')
    expect(await adapter.usage()).toBe(12)
    expect(await adapter.usage('m1')).toBe(10)
  })

  it('writes UTF-8 text with the correct byte size', async () => {
    const { adapter } = opfs()
    await adapter.writeFile('notes.md', '会议')
    expect((await adapter.readFile('notes.md'))?.size).toBe(6)
  })

  it('keeps data under the configured base folder', async () => {
    const { root, adapter } = opfs('recordings')
    await adapter.writeFile('r1/0001.part', 'x')
    expect(root.entries.has('recordings')).toBe(true)
    expect(await adapter.isReady()).toBe(true)
  })
})

describe('LocalFolderStorageAdapter', () => {
  it('is unset until a folder is picked', async () => {
    const { adapter } = localFolder()
    expect(await adapter.status()).toEqual({ permission: 'unset' })
    expect(await adapter.isReady()).toBe(false)
    await expect(adapter.writeFile('a.txt', 'x')).rejects.toBeInstanceOf(FolderNotReadyError)
  })

  it('persists the picked folder and becomes ready', async () => {
    const { adapter, store } = localFolder()
    expect(await adapter.pick()).toEqual({ permission: 'granted', name: 'HuiLu' })
    expect(store.handle).toBeDefined()
    await adapter.writeFile('m1/meeting.json', '{}')
    expect(await adapter.listMeetingDirs()).toEqual(['m1'])
  })

  it('returns undefined when the user cancels the picker and keeps the old folder', async () => {
    const { adapter, cancelNextPick } = localFolder()
    await adapter.pick()
    cancelNextPick()
    expect(await adapter.pick()).toBeUndefined()
    expect((await adapter.status()).name).toBe('HuiLu')
  })

  it('refuses to read or write once permission is lost (e.g. after a browser restart)', async () => {
    const { adapter, folder } = localFolder()
    await adapter.pick()
    folder.permission = 'prompt'
    expect(await adapter.status()).toEqual({ permission: 'prompt', name: 'HuiLu' })
    expect(await adapter.isReady()).toBe(false)
    const err = await adapter.writeFile('a.txt', 'x').catch((e) => e)
    expect(err).toBeInstanceOf(FolderNotReadyError)
    expect(err.permission).toBe('prompt')
    await expect(adapter.readFile('a.txt')).rejects.toBeInstanceOf(FolderNotReadyError)
  })

  it('recovers after re-authorization', async () => {
    const { adapter, folder } = localFolder()
    await adapter.pick()
    folder.permission = 'prompt'
    expect(await adapter.requestPermission()).toEqual({ permission: 'granted', name: 'HuiLu' })
    await expect(adapter.writeFile('a.txt', 'x')).resolves.toBeUndefined()
  })

  it('reports denial when the user refuses re-authorization', async () => {
    const { adapter, folder } = localFolder()
    await adapter.pick()
    folder.permission = 'prompt'
    folder.onRequestPermission = 'denied'
    expect((await adapter.requestPermission()).permission).toBe('denied')
    expect(await adapter.isReady()).toBe(false)
  })

  it('forgets the folder without touching its content', async () => {
    const { adapter, folder } = localFolder()
    await adapter.pick()
    await adapter.writeFile('m1/meeting.json', '{}')
    await adapter.forget()
    expect(await adapter.status()).toEqual({ permission: 'unset' })
    expect(folder.entries.has('m1')).toBe(true)
  })
})

describe('IdbHandleStore', () => {
  it('persists across store instances (simulating a page reload)', async () => {
    // fake-indexeddb 能结构化克隆普通对象；真实浏览器中存的是 FileSystemDirectoryHandle
    const handle = { name: 'HuiLu', kind: 'directory' } as unknown as FolderHandle
    await new IdbHandleStore('test').set(handle)
    expect(await new IdbHandleStore('test').get()).toEqual(handle)
    await new IdbHandleStore('test').clear()
    expect(await new IdbHandleStore('test').get()).toBeUndefined()
  })

  it('keeps separate keys apart', async () => {
    const a = { name: 'A' } as unknown as FolderHandle
    await new IdbHandleStore('k1').set(a)
    expect(await new IdbHandleStore('k2').get()).toBeUndefined()
  })
})
