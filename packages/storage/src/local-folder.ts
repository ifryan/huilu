import { DirectoryStorageAdapter } from './directory-adapter'
import { FolderNotReadyError } from './errors'
import type { DirectoryPicker, FolderHandle } from './fs-types'
import type { HandleStore } from './handle-store'

/** unset：还没选文件夹；prompt：需要用户在可见页面点击重新授权；denied：用户拒绝 */
export type FolderPermission = 'unset' | 'granted' | 'prompt' | 'denied'

export interface FolderStatus {
  permission: FolderPermission
  /** 文件夹名称。File System Access 不提供完整路径，只能拿到最后一级名称 */
  name?: string
}

const READWRITE = { mode: 'readwrite' } as const

const defaultPicker: DirectoryPicker = (options) =>
  (globalThis as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker(options)

/**
 * 用户选择的本地数据文件夹（File System Access），句柄持久化在 IndexedDB。
 *
 * - 授权随时可能失效（浏览器重启、插件重新加载），每次读写前都会 queryPermission
 * - pick / requestPermission 需要用户激活，只能在可见页面的点击事件里调用；
 *   离屏文档没有用户激活，只能在 isReady() 为 true 时直接读写
 */
export class LocalFolderStorageAdapter extends DirectoryStorageAdapter {
  readonly id = 'local-folder'

  constructor(
    private readonly store: HandleStore,
    private readonly picker: DirectoryPicker = defaultPicker,
  ) {
    super()
  }

  async status(): Promise<FolderStatus> {
    const handle = await this.store.get()
    if (!handle) return { permission: 'unset' }
    return { permission: await handle.queryPermission(READWRITE), name: handle.name }
  }

  async isReady(): Promise<boolean> {
    return (await this.status()).permission === 'granted'
  }

  /**
   * 弹出文件夹选择器并保存句柄。用户取消时返回 undefined。
   * 首次选择得到的是本次会话权限；浏览器重启后需要 requestPermission 一次，届时才会出现「每次访问时都允许」。
   */
  async pick(): Promise<FolderStatus | undefined> {
    let handle: FolderHandle
    try {
      handle = await this.picker({ id: 'huilu-data', mode: 'readwrite', startIn: 'documents' })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return undefined
      throw e
    }
    await this.store.set(handle)
    return this.status()
  }

  /** 重新授权；必须在可见页面的点击事件里调用 */
  async requestPermission(): Promise<FolderStatus> {
    const handle = await this.store.get()
    if (!handle) return { permission: 'unset' }
    return { permission: await handle.requestPermission(READWRITE), name: handle.name }
  }

  /** 断开数据文件夹（不删除文件夹里的任何内容） */
  async forget(): Promise<void> {
    await this.store.clear()
  }

  protected async root(): Promise<FileSystemDirectoryHandle> {
    const handle = await this.store.get()
    if (!handle) throw new FolderNotReadyError('unset')
    const permission = await handle.queryPermission(READWRITE)
    if (permission !== 'granted') throw new FolderNotReadyError(permission)
    return handle
  }
}
