import type { Meeting } from '@huilu/core'
import type {
  RecordingDirSink,
  RecordingManifest,
  RecordingSink,
  RecordingStore,
  TrackName,
} from '@huilu/recorder'

/**
 * 页面内录制的存储桥：录制在网页里进行（desktopCapture 的 streamId 只能在该网页的主框架里取流），
 * 但网页的 OPFS 属于网站，不是插件。插件页面 recorder-sink.html 以隐藏 iframe 嵌入网页，
 * 它的 OPFS 就是插件自己的；页面内录制把分片通过私有 MessagePort 交给它写入。
 *
 * 实测：OPFS 目录句柄不能跨源 postMessage（消息会被丢弃），Blob 可以。
 */

export const SINK_HELLO = 'huilu:recorder-sink'

type SinkCall =
  | { method: 'create'; id: string }
  | { method: 'remove'; id: string }
  | { method: 'writeChunk'; id: string; track: TrackName; seq: number; data: Blob }
  | { method: 'writeManifest'; id: string; manifest: RecordingManifest }
  | { method: 'writeMeeting'; id: string; meeting: Meeting }
  | { method: 'availableBytes' }

type SinkReply =
  { call: number; ok: true; value?: unknown } | { call: number; ok: false; error: string }

/** 网页一侧：把 RecordingSink 的调用转给 iframe */
export class RemoteRecordingSink implements RecordingSink {
  #next = 0
  readonly #pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

  constructor(private readonly port: MessagePort) {
    port.onmessage = ({ data }: MessageEvent<SinkReply>) => {
      const pending = this.#pending.get(data.call)
      if (!pending) return
      this.#pending.delete(data.call)
      if (data.ok) pending.resolve(data.value)
      else pending.reject(new Error(data.error))
    }
  }

  #call<T>(call: SinkCall): Promise<T> {
    const id = ++this.#next
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.port.postMessage({ call: id, ...call })
    })
  }

  async create(id: string): Promise<RecordingDirSink> {
    await this.#call({ method: 'create', id })
    return {
      writeChunk: (track, seq, data) => this.#call({ method: 'writeChunk', id, track, seq, data }),
      writeManifest: (manifest) => this.#call({ method: 'writeManifest', id, manifest }),
      writeMeeting: (meeting) => this.#call({ method: 'writeMeeting', id, meeting }),
    }
  }

  remove(id: string): Promise<void> {
    return this.#call({ method: 'remove', id })
  }

  availableBytes(): Promise<number | undefined> {
    return this.#call({ method: 'availableBytes' })
  }

  close() {
    for (const { reject } of this.#pending.values()) reject(new Error('Recorder sink closed'))
    this.#pending.clear()
    this.port.close()
  }
}

/**
 * iframe 一侧：只服务一个录制 id。网页本身也能嵌入这个页面并发消息，
 * 所以只认通过后台校验过令牌的端口，并且只允许写入 / 删除这个端口自己创建的录制。
 */
export function serveRecordingSink(
  port: MessagePort,
  store: RecordingStore,
  availableBytes: () => Promise<number | undefined>,
) {
  let ownId: string | undefined
  const dirs = new Map<string, RecordingDirSink>()
  const handle = async (call: SinkCall): Promise<unknown> => {
    if (call.method === 'availableBytes') return availableBytes()
    if (call.method === 'create') {
      if (ownId !== undefined && ownId !== call.id) throw new Error('Sink already owns a recording')
      ownId = call.id
      dirs.set(call.id, await store.create(call.id))
      return undefined
    }
    if (call.id !== ownId) throw new Error('Recording not owned by this sink')
    if (call.method === 'remove') {
      dirs.delete(call.id)
      return store.remove(call.id)
    }
    const dir = dirs.get(call.id)
    if (!dir) throw new Error('Recording directory not open')
    if (call.method === 'writeChunk') return dir.writeChunk(call.track, call.seq, call.data)
    if (call.method === 'writeManifest') return dir.writeManifest(call.manifest)
    return dir.writeMeeting(call.meeting)
  }
  port.onmessage = ({ data }: MessageEvent<SinkCall & { call: number }>) => {
    handle(data).then(
      (value) => port.postMessage({ call: data.call, ok: true, value } satisfies SinkReply),
      (e: unknown) =>
        port.postMessage({
          call: data.call,
          ok: false,
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        } satisfies SinkReply),
    )
  }
}
