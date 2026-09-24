import type { FolderHandle } from './fs-types'

/** 保存数据文件夹句柄的地方；句柄可以结构化克隆进 IndexedDB，插件的所有页面与离屏文档共享 */
export interface HandleStore {
  get(): Promise<FolderHandle | undefined>
  set(handle: FolderHandle): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'huilu-handles'
const STORE = 'handles'

/** 基于 IndexedDB 的句柄存储。独立数据库，避免与以后的 Dexie 缓存库互相影响版本号 */
export class IdbHandleStore implements HandleStore {
  constructor(
    private readonly key = 'dataFolder',
    private readonly idb: IDBFactory = indexedDB,
  ) {}

  get(): Promise<FolderHandle | undefined> {
    return this.#tx('readonly', (s) => s.get(this.key)) as Promise<FolderHandle | undefined>
  }

  async set(handle: FolderHandle): Promise<void> {
    await this.#tx('readwrite', (s) => s.put(handle, this.key))
  }

  async clear(): Promise<void> {
    await this.#tx('readwrite', (s) => s.delete(this.key))
  }

  async #tx(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await this.#open()
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        t.oncomplete = () => resolve(req.result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
    } finally {
      db.close()
    }
  }

  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
}
