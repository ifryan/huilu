import {
  RecorderBusyError,
  RecorderController,
  browserMediaBackend,
  mixCapturedStream,
  videoDimensions,
  type ControllerDeps,
  type RecordingOptions,
  type RecordingStore,
  type VideoQuality,
} from '@huilu/recorder'

export type Release = () => void
export type Acquire = () => Promise<Release>

/** Hold the origin-wide lease until the session has actually finished, including write failure. */
export function acquireRecordingLease(locks: LockManager = navigator.locks): Promise<Release> {
  return new Promise((resolve, reject) => {
    void locks
      .request('huilu:web-recording', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new RecorderBusyError('Another tab is recording'))
          return
        }
        await new Promise<void>((release) => resolve(release))
      })
      .catch(reject)
  })
}

export function chooseDisplay(sourceAudio: boolean, quality: VideoQuality | null) {
  const { width, height } = quality ? videoDimensions(quality) : { width: 640, height: 360 }
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: {
      displaySurface: 'browser',
      width: { max: width },
      height: { max: height },
      frameRate: { max: quality?.fps ?? 1 },
    },
    audio: sourceAudio,
    systemAudio: sourceAudio ? 'include' : 'exclude',
    windowAudio: sourceAudio ? 'system' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  }
  return navigator.mediaDevices.getDisplayMedia(options)
}

export class WebRecorder {
  readonly controller: RecorderController
  #starting = false
  #release?: Release
  #stream?: MediaStream
  constructor(
    deps: Pick<ControllerDeps, 'store' | 'onFinished'> & { store: RecordingStore },
    private readonly acquire: Acquire = acquireRecordingLease,
    private readonly choose = chooseDisplay,
    media = browserMediaBackend,
  ) {
    this.controller = new RecorderController({
      ...deps,
      media: { ...media, capture: (request) => mixCapturedStream(request, this.#stream!) },
      onFinished: (result) => {
        this.#release?.()
        this.#release = undefined
        deps.onFinished?.(result)
      },
    })
  }
  async start(options: Omit<RecordingOptions, 'id' | 'streamId' | 'source'>) {
    if (this.#starting || this.controller.status().state !== 'idle') throw new RecorderBusyError()
    this.#starting = true
    let selection: Promise<MediaStream> | undefined
    let lease: Promise<Release> | undefined
    try {
      // Both calls are made before the first await, preserving getDisplayMedia user activation.
      lease = this.acquire()
      selection = this.choose(
        options.sourceAudio,
        options.mode === 'video' ? options.quality : null,
      )
      const [release, stream] = await Promise.all([lease, selection])
      this.#release = release
      this.#stream = stream
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface
      const source =
        surface === 'browser'
          ? 'tab'
          : surface === 'window'
            ? 'window'
            : surface === 'monitor'
              ? 'screen'
              : undefined
      if (!source) throw new Error('The browser did not identify the selected source')
      return await this.controller.start({
        ...options,
        source,
        streamId: '',
        sourceAudioRequested: options.sourceAudio,
      })
    } catch (error) {
      // If one promise rejects first, still clean up the other once it settles.
      void selection?.then(
        (stream) => stream.getTracks().forEach((track) => track.stop()),
        () => {},
      )
      void lease?.then(
        (release) => release(),
        () => {},
      )
      this.#release = undefined
      throw error
    } finally {
      this.#starting = false
      this.#stream = undefined
    }
  }
  status() {
    return this.#starting ? { state: 'starting' as const } : this.controller.status()
  }
}
