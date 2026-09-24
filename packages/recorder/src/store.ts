import { Meeting, migrateMeeting } from '@huilu/core'
import { RecordingManifest, type TrackName } from './manifest'

/** OPFS 写入失败：包括「没有抛错但写进去的大小不对」（ADR 0004 第 2 节） */
export class ChunkWriteError extends Error {
  override name = 'ChunkWriteError'
}

export type DirectoryProvider = () => Promise<FileSystemDirectoryHandle>

/** OPFS 中存放录制的目录；每个录制一个子目录，结束后含 meeting.json */
export const RECORDINGS_DIR = 'recordings'
const MANIFEST = 'manifest.json'
const MEETING = 'meeting.json'

export const chunkFileName = (seq: number) => `${String(seq).padStart(6, '0')}.part`

function byteLength(data: Blob | string): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.size
}

/**
 * 写入后回读文件大小校验：OPFS 出问题时 createWritable → write → close 可能都不报错，
 * 却留下 0 字节文件，必须回读才能发现。
 */
export async function writeVerified(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
): Promise<void> {
  const expected = byteLength(data)
  let written: number
  try {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
    written = (await handle.getFile()).size
  } catch (e) {
    throw new ChunkWriteError(`${name}: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    })
  }
  if (written !== expected) {
    throw new ChunkWriteError(`${name}: wrote ${written} of ${expected} bytes`)
  }
}

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | undefined> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text()
  } catch {
    return undefined
  }
}

/** 单个录制在 OPFS 中的目录：recordings/<id>/{manifest.json, meeting.json, video/, audio/} */
export class RecordingDir {
  readonly #tracks = new Map<TrackName, FileSystemDirectoryHandle>()

  constructor(
    readonly id: string,
    readonly handle: FileSystemDirectoryHandle,
  ) {}

  async #trackDir(track: TrackName, create = true) {
    let dir = this.#tracks.get(track)
    if (!dir) {
      dir = await this.handle.getDirectoryHandle(track, { create })
      this.#tracks.set(track, dir)
    }
    return dir
  }

  async writeChunk(track: TrackName, seq: number, data: Blob): Promise<void> {
    await writeVerified(await this.#trackDir(track), chunkFileName(seq), data)
  }

  async writeManifest(manifest: RecordingManifest): Promise<void> {
    await writeVerified(this.handle, MANIFEST, JSON.stringify(manifest))
  }

  async readManifest(): Promise<RecordingManifest | undefined> {
    const text = await readText(this.handle, MANIFEST)
    if (text === undefined) return undefined
    try {
      return RecordingManifest.parse(JSON.parse(text))
    } catch {
      return undefined
    }
  }

  async writeMeeting(meeting: Meeting): Promise<void> {
    await writeVerified(this.handle, MEETING, JSON.stringify(Meeting.parse(meeting), null, 2))
  }

  async readMeeting(): Promise<Meeting | undefined> {
    const text = await readText(this.handle, MEETING)
    return text === undefined ? undefined : migrateMeeting(JSON.parse(text))
  }

  /**
   * 磁盘上从 000001 开始连续、非空的分片大小。中途出现缺号或 0 字节时截断：
   * 之后的数据无法可靠地按顺序拼接。
   */
  async scanChunks(track: TrackName): Promise<number[]> {
    let dir: FileSystemDirectoryHandle
    try {
      dir = await this.#trackDir(track, false)
    } catch {
      return []
    }
    const sizes: number[] = []
    for (let seq = 1; ; seq++) {
      let size: number
      try {
        size = (await (await dir.getFileHandle(chunkFileName(seq))).getFile()).size
      } catch {
        break
      }
      if (size === 0) break
      sizes.push(size)
    }
    return sizes
  }

  /**
   * 按顺序拼接前 chunks 个分片（File 是惰性的，不会把内容读进内存）。
   * MediaRecorder 的 timeslice 输出本身是一条连续字节流，直接拼接即可播放。
   */
  async readTrack(track: TrackName, chunks: number, type: string): Promise<Blob> {
    const dir = await this.#trackDir(track, false)
    const parts: File[] = []
    for (let seq = 1; seq <= chunks; seq++) {
      parts.push(await (await dir.getFileHandle(chunkFileName(seq))).getFile())
    }
    return new Blob(parts, { type })
  }
}

/** OPFS 中所有录制的根目录。录制期间只写这里（不需要授权），结束后由处理管线写入用户文件夹。 */
export class RecordingStore {
  constructor(private readonly getRoot: DirectoryProvider) {}

  async #recordings() {
    return (await this.getRoot()).getDirectoryHandle(RECORDINGS_DIR, { create: true })
  }

  async create(id: string): Promise<RecordingDir> {
    const handle = await (await this.#recordings()).getDirectoryHandle(id, { create: true })
    return new RecordingDir(id, handle)
  }

  async open(id: string): Promise<RecordingDir | undefined> {
    try {
      return new RecordingDir(id, await (await this.#recordings()).getDirectoryHandle(id))
    } catch {
      return undefined
    }
  }

  async list(): Promise<string[]> {
    const ids: string[] = []
    for await (const [name, handle] of (await this.#recordings()).entries()) {
      if (handle.kind === 'directory') ids.push(name)
    }
    return ids.sort()
  }

  async remove(id: string): Promise<void> {
    await (await this.#recordings()).removeEntry(id, { recursive: true })
  }
}
