import type { MeetingEntry } from './meeting-library'

export interface IndexSnapshot {
  entries: MeetingEntry[]
  root: FileSystemDirectoryHandle
}

/** Disposable cache only. Rebuilding never touches handles, jobs, or meeting files. */
export class MeetingIndex {
  constructor(private readonly idb?: IDBFactory) {}
  async read(): Promise<IndexSnapshot | undefined> {
    return this.tx('readonly', (s) => s.get('snapshot')) as Promise<IndexSnapshot | undefined>
  }
  async replace(snapshot: IndexSnapshot): Promise<void> {
    await this.tx('readwrite', (s) => s.put(snapshot, 'snapshot'))
  }
  async clear(): Promise<void> {
    await this.tx('readwrite', (s) => s.clear())
  }
  private async tx(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = (this.idb ?? indexedDB).open('huilu-library', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('index')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('index', mode)
        const req = run(tx.objectStore('index'))
        tx.oncomplete = () => resolve(req.result)
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }
}
