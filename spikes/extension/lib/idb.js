// 极简 IndexedDB 键值存储：用来保存 FileSystemDirectoryHandle（句柄可以结构化克隆进 IndexedDB）

const DB_NAME = 'huilu-spike'
const STORE = 'kv'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
  })
}

export const kvGet = (key) => tx('readonly', (s) => s.get(key))
export const kvSet = (key, value) => tx('readwrite', (s) => s.put(value, key))
export const kvDel = (key) => tx('readwrite', (s) => s.delete(key))
