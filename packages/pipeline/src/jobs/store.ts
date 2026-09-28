import type { ProcessingJob } from './types'

/** 处理任务的持久化存储 */
export interface JobStore {
  get(meetingId: string): Promise<ProcessingJob | undefined>
  list(): Promise<ProcessingJob[]>
  put(job: ProcessingJob): Promise<void>
  delete(meetingId: string): Promise<void>
}

const DB_NAME = 'huilu-pipeline'
const STORE = 'jobs'

/**
 * 基于 IndexedDB 的任务存储：插件的所有页面、离屏文档、后台 Service Worker 同源共享。
 * 只有离屏文档里的处理队列写入；后台和插件网页只读（判断是否需要唤醒、显示进度）。
 * 独立数据库，避免与句柄存储、以后的 Dexie 缓存互相影响版本号。
 */
export class IdbJobStore implements JobStore {
  #writes: Promise<unknown> = Promise.resolve()

  /** idb 缺省时在第一次使用时取全局 indexedDB（后台测试等环境可以只构造、不使用） */
  constructor(private readonly idb?: IDBFactory) {}

  async get(meetingId: string): Promise<ProcessingJob | undefined> {
    return (await this.#tx('readonly', (s) => s.get(meetingId))) as ProcessingJob | undefined
  }

  async list(): Promise<ProcessingJob[]> {
    return (await this.#tx('readonly', (s) => s.getAll())) as ProcessingJob[]
  }

  /** 写入按调用顺序串行，进度更新不会被较早的写入覆盖 */
  put(job: ProcessingJob): Promise<void> {
    const snapshot = structuredClone(job)
    return this.#serial(() => this.#tx('readwrite', (s) => s.put(snapshot)))
  }

  delete(meetingId: string): Promise<void> {
    return this.#serial(() => this.#tx('readwrite', (s) => s.delete(meetingId)))
  }

  #serial(write: () => Promise<unknown>): Promise<void> {
    const run = this.#writes.then(write)
    this.#writes = run.catch(() => {})
    return run.then(() => {})
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
      const req = (this.idb ?? indexedDB).open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'meetingId' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
}

/** 内存实现，测试与非浏览器环境用 */
export class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, ProcessingJob>()

  async get(meetingId: string) {
    const job = this.jobs.get(meetingId)
    return job && structuredClone(job)
  }

  async list() {
    return [...this.jobs.values()].map((j) => structuredClone(j))
  }

  async put(job: ProcessingJob) {
    this.jobs.set(job.meetingId, structuredClone(job))
  }

  async delete(meetingId: string) {
    this.jobs.delete(meetingId)
  }
}
