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
