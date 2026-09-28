// 测试用的内存版 File System Access 实现（只实现存储适配器用到的部分）
import type { FolderHandle, FsPermissionState } from './fs-types'

const notFound = (name: string) => new DOMException(`${name} not found`, 'NotFoundError')

export class MemoryFileHandle {
  readonly kind = 'file'
  data = new Uint8Array()
  constructor(
    readonly name: string,
    private readonly fs: { silentWriteFailure: boolean },
  ) {}

  async getFile(): Promise<File> {
    return new File([this.data], this.name)
  }

  async createWritable(options: { keepExistingData?: boolean } = {}) {
    let buffer = options.keepExistingData ? this.data.slice() : new Uint8Array()
    let position = 0
    return {
      seek: async (p: number) => {
        position = p
      },
      write: async (chunk: Blob | string) => {
        const bytes = new Uint8Array(
          await (typeof chunk === 'string' ? new Blob([chunk]) : chunk).arrayBuffer(),
        )
        const next = new Uint8Array(Math.max(buffer.length, position + bytes.length))
        next.set(buffer)
        next.set(bytes, position)
        buffer = next
        position += bytes.length
      },
      close: async () => {
        // 模拟 ADR 0004 中遇到的情况：close 不抛错，但文件实际是 0 字节
        this.data = this.fs.silentWriteFailure ? new Uint8Array() : buffer
      },
      abort: async () => {},
    }
  }
}

export class MemoryDirectoryHandle {
  readonly kind = 'directory'
  readonly entries = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>()
  permission: FsPermissionState = 'granted'
  /** 用户在权限弹窗中的选择 */
  onRequestPermission: FsPermissionState = 'granted'

  constructor(
    readonly name: string,
    readonly fs = { silentWriteFailure: false },
  ) {}

  async getDirectoryHandle(name: string, { create = false } = {}) {
    const entry = this.entries.get(name)
    if (entry instanceof MemoryDirectoryHandle) return entry
    if (entry) throw new DOMException(name, 'TypeMismatchError')
    if (!create) throw notFound(name)
    const dir = new MemoryDirectoryHandle(name, this.fs)
    this.entries.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, { create = false } = {}) {
    const entry = this.entries.get(name)
    if (entry instanceof MemoryFileHandle) return entry
    if (entry) throw new DOMException(name, 'TypeMismatchError')
    if (!create) throw notFound(name)
    const file = new MemoryFileHandle(name, this.fs)
    this.entries.set(name, file)
    return file
  }

  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw notFound(name)
  }

  async *values() {
    yield* this.entries.values()
  }

  async queryPermission() {
    return this.permission
  }

  async requestPermission() {
    this.permission = this.onRequestPermission
    return this.permission
  }

  asFolder(): FolderHandle {
    return this as unknown as FolderHandle
  }
}
