import { DirectoryStorageAdapter } from './directory-adapter'
import { splitPath } from './path'

export type OpfsRootProvider = () => Promise<FileSystemDirectoryHandle>

const defaultRoot: OpfsRootProvider = () => navigator.storage.getDirectory()

/**
 * 浏览器私有文件系统（OPFS）：不需要用户授权，录制分片只写这里；
 * 录制结束后再整理写入用户的数据文件夹（ADR 0004 第 1 节）。
 */
export class OpfsStorageAdapter extends DirectoryStorageAdapter {
  readonly id = 'opfs'
  readonly #getRoot: OpfsRootProvider
  readonly #base: string[]

  /** base：OPFS 中的子目录，例如 'recordings'；为空时直接使用 OPFS 根目录 */
  constructor(options: { base?: string; getRoot?: OpfsRootProvider } = {}) {
    super()
    this.#getRoot = options.getRoot ?? defaultRoot
    this.#base = options.base ? splitPath(options.base) : []
  }

  async isReady(): Promise<boolean> {
    try {
      await this.root()
      return true
    } catch {
      return false
    }
  }

  protected async root(): Promise<FileSystemDirectoryHandle> {
    let dir = await this.#getRoot()
    for (const name of this.#base) dir = await dir.getDirectoryHandle(name, { create: true })
    return dir
  }
}
