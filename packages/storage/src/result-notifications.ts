/** Durable at-most-once claims, separate from rebuildable history and pipeline jobs. */
export async function claimResultNotification(
  id: string,
  factory: IDBFactory = indexedDB,
): Promise<boolean> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('huilu-result-notifications', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('opened')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let claimed = false
      const tx = db.transaction('opened', 'readwrite')
      const store = tx.objectStore('opened')
      const req = store.get(id)
      req.onsuccess = () => {
        if (req.result === undefined) {
          store.put(Date.now(), id)
          claimed = true
        }
      }
      tx.oncomplete = () => resolve(claimed)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** 只有取得 claim 且投递失败的调用者可释放，供下一次显式重试。 */
export async function releaseResultNotification(
  id: string,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('huilu-result-notifications', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('opened')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('opened', 'readwrite')
      transaction.objectStore('opened').delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
