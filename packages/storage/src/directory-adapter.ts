import type { StorageAdapter } from '@huilu/core'
import { WriteVerificationError } from './errors'
import { splitPath } from './path'

/** 每场会议文件夹中必有的元数据文件；只有包含它的子文件夹才算会议 */
export const MEETING_FILE = 'meeting.json'

const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError'

/**
 * 基于 FileSystemDirectoryHandle 的存储实现，本地文件夹与 OPFS 共用。
 * 每次写入后回读文件大小做校验，不一致时抛 WriteVerificationError。
 */
export abstract class DirectoryStorageAdapter implements StorageAdapter {
  abstract readonly id: string
  abstract isReady(): Promise<boolean>
  /** 返回根目录；不可用时抛错（例如文件夹未授权） */
  protected abstract root(): Promise<FileSystemDirectoryHandle>

  async listMeetingDirs(): Promise<string[]> {
    const root = await this.root()
    const dirs: string[] = []
    for await (const entry of root.values()) {
      if (entry.kind !== 'directory') continue
      try {
        await (entry as FileSystemDirectoryHandle).getFileHandle(MEETING_FILE)
        dirs.push(entry.name)
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
    }
    // 文件夹名以「日期_时间」开头，倒序即最新在前
    return dirs.sort((a, b) => b.localeCompare(a))
  }

  async readFile(path: string): Promise<Blob | undefined> {
    try {
      const file = await this.#fileHandle(path, false)
      return await file.getFile()
    } catch (e) {
      if (isNotFound(e)) return undefined
      throw e
    }
  }

  async writeFile(path: string, data: Blob | string): Promise<void> {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data
    const handle = await this.#fileHandle(path, true)
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
      await writable.close()
    } catch (e) {
      await writable.abort().catch(() => {})
      throw e
    }
    await verifySize(handle, path, blob.size)
  }

  async appendFile(path: string, data: Blob): Promise<void> {
    const handle = await this.#fileHandle(path, true)
    const before = (await handle.getFile()).size
    const writable = await handle.createWritable({ keepExistingData: true })
    try {
      await writable.seek(before)
      await writable.write(data)
      await writable.close()
    } catch (e) {
      await writable.abort().catch(() => {})
      throw e
    }
    await verifySize(handle, path, before + data.size)
  }

  async remove(path: string): Promise<void> {
    const parts = splitPath(path)
    const name = parts.pop()!
    try {
      const dir = await this.#dir(parts, false)
      await dir.removeEntry(name, { recursive: true })
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }

  /** 统计根目录（或某个子目录）下所有文件的总字节数 */
  async usage(path?: string): Promise<number> {
    const dir = path ? await this.#dir(splitPath(path), false) : await this.root()
    return sumSizes(dir)
  }

  async #dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root()
    for (const name of parts) dir = await dir.getDirectoryHandle(name, { create })
    return dir
  }

  async #fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = splitPath(path)
    const name = parts.pop()!
    const dir = await this.#dir(parts, create)
    return dir.getFileHandle(name, { create })
  }
}

async function verifySize(handle: FileSystemFileHandle, path: string, expected: number) {
  const actual = (await handle.getFile()).size
  if (actual !== expected) throw new WriteVerificationError(path, expected, actual)
}

async function sumSizes(dir: FileSystemDirectoryHandle): Promise<number> {
  let total = 0
  for await (const entry of dir.values()) {
    total +=
      entry.kind === 'file'
        ? (await (entry as FileSystemFileHandle).getFile()).size
        : await sumSizes(entry as FileSystemDirectoryHandle)
  }
  return total
}
