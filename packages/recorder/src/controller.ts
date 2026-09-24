import type { Meeting, RecordingMode } from '@huilu/core'
import { isUnfinished, type TrackName } from './manifest'
import { hasRecordedData, meetingFromManifest } from './meeting'
import {
  RecordingSession,
  type FinishedRecording,
  type RecordingOptions,
  type SessionDeps,
  type SessionStatus,
} from './session'

export class RecorderBusyError extends Error {
  override name = 'RecorderBusyError'
}

export interface RecorderStatus {
  state: 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
  session?: SessionStatus
  /** 最近一次结束的录制（本次离屏文档生命周期内） */
  lastResult?: Omit<FinishedRecording, 'meeting'> & { saved: boolean }
}

/** 浏览器崩溃 / 离屏文档被关闭时没有正常收尾的录制 */
export interface UnfinishedRecording {
  id: string
  title: string
  mode: RecordingMode
  startedAt: number
  /** 最后一次落盘时的录制时长 */
  activeMs: number
  bytes: number
}

export interface ControllerDeps extends SessionDeps {
  /** 录制结束（用户结束、来源结束、写入失败）后回调，用于通知后台 */
  onFinished?: (result: FinishedRecording) => void
}

/** 录制 id：本地时间 + 随机后缀，按字典序即时间顺序 */
export function createRecordingId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `${stamp}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * 离屏文档中唯一的录制入口：同一时间只允许一个录制（开始录制互斥），并负责恢复未完成的录制。
 */
export class RecorderController {
  #session?: RecordingSession
  #lastResult?: RecorderStatus['lastResult']

  constructor(private readonly deps: ControllerDeps) {}

  /**
   * 在第一个 await 之前就占住 #session：连续点击、快捷键与弹窗同时触发时，第二个请求直接被拒绝。
   */
  async start(options: Omit<RecordingOptions, 'id'> & { id?: string }): Promise<RecorderStatus> {
    if (this.#session?.active) {
      throw new RecorderBusyError(`A recording is already ${this.#session.state}`)
    }
    const session = new RecordingSession(
      { ...options, id: options.id ?? createRecordingId(new Date(this.#now())) },
      this.deps,
    )
    this.#session = session
    void session.finished.then((result) => {
      const { meeting, ...rest } = result
      this.#lastResult = { ...rest, saved: meeting !== undefined }
      this.deps.onFinished?.(result)
    })
    try {
      await session.start()
    } catch (e) {
      if (this.#session === session) this.#session = undefined
      throw e
    }
    return this.status()
  }

  pause(): RecorderStatus {
    this.#session?.pause()
    return this.status()
  }

  resume(): RecorderStatus {
    this.#session?.resume()
    return this.status()
  }

  async stop(): Promise<RecorderStatus> {
    const session = this.#session
    if (
      session &&
      (session.state === 'recording' || session.state === 'paused' || session.state === 'stopping')
    ) {
      await session.stop('user')
    }
    return this.status()
  }

  status(): RecorderStatus {
    const session = this.#session
    if (session?.active) {
      return {
        state: session.state as RecorderStatus['state'],
        session: session.status(),
        lastResult: this.#lastResult,
      }
    }
    return { state: 'idle', lastResult: this.#lastResult }
  }

  get #activeId() {
    return this.#session?.active ? this.#session.options.id : undefined
  }

  #now() {
    return (this.deps.now ?? Date.now)()
  }

  async listUnfinished(): Promise<UnfinishedRecording[]> {
    const out: UnfinishedRecording[] = []
    for (const id of await this.deps.store.list()) {
      if (id === this.#activeId) continue
      const manifest = await (await this.deps.store.open(id))?.readManifest()
      if (!manifest || !isUnfinished(manifest)) continue
      out.push({
        id,
        title: manifest.title,
        mode: manifest.mode,
        startedAt: manifest.startedAt,
        activeMs: manifest.activeMs,
        bytes: Object.values(manifest.tracks).reduce((sum, t) => sum + (t?.bytes ?? 0), 0),
      })
    }
    return out
  }

  /**
   * 恢复未完成的录制：以磁盘上实际存在的连续分片为准（manifest 可能比分片落后一个），
   * 生成 meeting.json（只剩视频时 status = failed，见 meetingFromManifest）。所有轨道都没有分片时返回 undefined。
   */
  async recover(id: string): Promise<Meeting | undefined> {
    if (id === this.#activeId) throw new RecorderBusyError('This recording is still in progress')
    const dir = await this.deps.store.open(id)
    const manifest = await dir?.readManifest()
    if (!dir || !manifest) throw new Error(`Recording ${id} not found`)
    if (!isUnfinished(manifest)) return dir.readMeeting()

    for (const name of Object.keys(manifest.tracks) as TrackName[]) {
      const track = manifest.tracks[name]!
      const sizes = await dir.scanChunks(name)
      manifest.tracks[name] = {
        ...track,
        chunks: sizes.length,
        bytes: sizes.reduce((a, b) => a + b, 0),
        sizes,
      }
    }
    manifest.endReason = 'recovered'
    manifest.updatedAt = this.#now()
    if (!hasRecordedData(manifest)) {
      // 崩溃发生在任何分片落盘之前：没有可恢复的内容
      await this.deps.store.remove(id)
      return undefined
    }
    if (!manifest.tracks.audio?.chunks) {
      manifest.error ??=
        'Transcript audio track recorded no data; this recording cannot be transcribed'
    }
    const meeting = meetingFromManifest(manifest)
    await dir.writeMeeting(meeting)
    manifest.state = 'stopped'
    await dir.writeManifest(manifest)
    return meeting
  }

  async discard(id: string): Promise<void> {
    if (id === this.#activeId) throw new RecorderBusyError('This recording is still in progress')
    await this.deps.store.remove(id)
  }
}
