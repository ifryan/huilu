// 单元测试用的假实现：内存文件系统（可注入写入故障）、MediaRecorder、媒体采集

import type {
  CaptureRequest,
  CapturedMedia,
  MediaBackend,
  RecorderLike,
  RecorderOptions,
  RecorderWarning,
} from './media'

type WriteFault = 'throw' | 'empty' | undefined

class MemoryFile {
  data: Blob = new Blob([])
}

class MemoryFileHandle {
  readonly kind = 'file'
  constructor(
    readonly name: string,
    private readonly file: MemoryFile,
    private readonly fs: MemoryFs,
  ) {}

  async createWritable() {
    const parts: (Blob | string)[] = []
    return {
      write: async (data: Blob | string) => void parts.push(data),
      close: async () => {
        const fault = this.fs.faultFor(this.name)
        if (fault === 'throw') throw new DOMException('disk failure', 'InvalidStateError')
        // 'empty' 模拟 ADR 0004 中的事故：写入不报错，但文件是 0 字节
        this.file.data = fault === 'empty' ? new Blob([]) : new Blob(parts)
      },
    }
  }

  async getFile() {
    return new File([this.file.data], this.name)
  }
}

export class MemoryDirHandle {
  readonly kind = 'directory'
  readonly dirs = new Map<string, MemoryDirHandle>()
  readonly files = new Map<string, MemoryFile>()

  constructor(
    readonly name: string,
    private readonly fs: MemoryFs,
  ) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options?.create) throw new DOMException(name, 'NotFoundError')
      dir = new MemoryDirHandle(name, this.fs)
      this.dirs.set(name, dir)
    }
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    let file = this.files.get(name)
    if (!file) {
      if (!options?.create) throw new DOMException(name, 'NotFoundError')
      file = new MemoryFile()
      this.files.set(name, file)
    }
    return new MemoryFileHandle(name, file, this.fs)
  }

  async removeEntry(name: string) {
    if (!this.dirs.delete(name) && !this.files.delete(name)) {
      throw new DOMException(name, 'NotFoundError')
    }
  }

  async *entries(): AsyncIterable<[string, MemoryDirHandle | MemoryFileHandle]> {
    for (const [name, dir] of this.dirs) yield [name, dir]
    for (const [name, file] of this.files) yield [name, new MemoryFileHandle(name, file, this.fs)]
  }

  /** 测试断言用：按路径读文件内容 */
  async read(path: string): Promise<string | undefined> {
    const parts = path.split('/')
    const dir = parts
      .slice(0, -1)
      .reduce<MemoryDirHandle | undefined>((d, p) => d?.dirs.get(p), this)
    return dir?.files.get(parts.at(-1)!)?.data.text()
  }
}

export class MemoryFs {
  readonly root = new MemoryDirHandle('', this)
  fault: (name: string) => WriteFault = () => undefined

  faultFor(name: string) {
    return this.fault(name)
  }

  provider = async () => this.root as unknown as FileSystemDirectoryHandle
}

export class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null
  timeslice?: number
  /** stop() 时输出的最后一个分片 */
  finalChunk: Blob | undefined = new Blob(['tail'])

  constructor(
    readonly tracks: MediaStreamTrack[],
    readonly options: RecorderOptions,
  ) {}

  get mimeType() {
    return this.options.mimeType ?? ''
  }

  start(timeslice?: number) {
    this.timeslice = timeslice
    this.state = 'recording'
  }

  emit(data: Blob | string) {
    this.ondataavailable?.({ data: typeof data === 'string' ? new Blob([data]) : data })
  }

  pause() {
    this.state = 'paused'
  }

  resume() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (this.finalChunk) this.emit(this.finalChunk)
    queueMicrotask(() => this.onstop?.())
  }
}

const fakeTrack = (kind: string) => ({ kind, id: `${kind}-${Math.random()}` }) as MediaStreamTrack

export class FakeMedia implements MediaBackend {
  recorders: FakeRecorder[] = []
  requests: CaptureRequest[] = []
  stopped = 0
  warnings: RecorderWarning[] = []
  available: number | undefined = 100 * 2 ** 30
  supported: (mime: string) => boolean = (m) =>
    !m.includes('mp4a') && !m.includes('mp4;codecs=opus')
  captureError: Error | undefined
  #ended: (() => void)[] = []

  async capture(request: CaptureRequest): Promise<CapturedMedia> {
    this.requests.push(request)
    if (this.captureError) throw this.captureError
    return {
      videoTrack: request.mode === 'video' ? fakeTrack('video') : undefined,
      audioTrack: fakeTrack('audio'),
      transcriptAudioTrack: fakeTrack('audio'),
      videoSettings: request.mode === 'video' ? { width: 1280, height: 720, fps: 15 } : undefined,
      warnings: [...this.warnings],
      onEnded: (cb) => void this.#ended.push(cb),
      stop: () => void this.stopped++,
    }
  }

  createRecorder(tracks: MediaStreamTrack[], options: RecorderOptions) {
    const r = new FakeRecorder(tracks, options)
    this.recorders.push(r)
    return r
  }

  isTypeSupported = (mime: string) => this.supported(mime)

  async availableBytes() {
    return this.available
  }

  /** 模拟标签页关闭 / 停止共享 */
  endSource() {
    this.#ended.forEach((cb) => cb())
  }
}

export class FakeClock {
  t = Date.UTC(2026, 8, 24, 6, 30)
  now = () => this.t
  advance(ms: number) {
    this.t += ms
  }
}

/** 等待写入队列（Promise 链）跑完 */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
