/**
 * 页面内录制：统一来源选择时，后台把录制设置交给这里（page:arm），用户在网页的录制面板上点
 * 「选择来源」后用 getDisplayMedia 弹出选择框——只有它能让窗口来源带上系统声音，而它要求网页内的点击。
 * 取流、混音和 MediaRecorder 都在这里运行；分片交给隐藏的插件 iframe 写进插件 OPFS（lib/recorder-sink）。
 * 不用再开一个采集标签页。
 *
 * 代价：录制跟着网页走，刷新 / 跳转 / 关闭网页会中断录制（已写入的分片可在「未完成的录制」中恢复）；
 * 麦克风按网页所在网站授权。注入失败的页面（如 chrome://）由后台退回采集标签页。
 */
import { browser, defineContentScript } from '#imports'
import { RecorderController, browserMediaBackend, mixCapturedStream } from '@huilu/recorder'
import { onMessage, sendMessage, type WindowRecordingOptions } from '@/lib/messaging'
import { registerPageCapture, type PageCaptureControls } from '@/lib/page-capture'
import { RemoteRecordingSink, SINK_HELLO } from '@/lib/recorder-sink'
import { CaptureCancelledError, openDisplaySource } from '@/platform/capture'

const SINK_TIMEOUT_MS = 10_000
/** 一直没点「选择来源」就放弃，不让后台一直处于「正在开始」 */
const ARM_TIMEOUT_MS = 2 * 60_000

/** 同一网页可能被多次注入（每次开始录制都会注入），只保留第一份实例 */
const LOADED = '__huiluCaptureLoaded'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    const scope = globalThis as typeof globalThis & { [LOADED]?: boolean }
    if (scope[LOADED]) return
    scope[LOADED] = true

    let frame: HTMLIFrameElement | undefined
    let sink: RemoteRecordingSink | undefined
    let controller: RecorderController<RemoteRecordingSink> | undefined
    /** 已就绪、等用户点「选择来源」的录制设置 */
    let armed: WindowRecordingOptions | undefined
    let armTimer: ReturnType<typeof setTimeout> | undefined
    /** 选择框开着到录制开始之间 */
    let picking = false

    const release = () => {
      clearTimeout(armTimer)
      sink?.close()
      frame?.remove()
      sink = frame = controller = armed = undefined
      picking = false
    }
    const busy = () =>
      armed !== undefined ||
      picking ||
      (controller !== undefined && controller.status().state !== 'idle')
    const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    const fail = (error: unknown) => {
      release()
      void sendMessage('pageRecordingFailed', errorText(error)).catch((e: unknown) =>
        console.error('[huilu] failed to notify background', e),
      )
    }

    /** 嵌入存储 iframe，交给它一个私有端口；后台校验令牌通过后 iframe 回 ready */
    const prepare = (token: string) =>
      new Promise<void>((resolve, reject) => {
        release()
        const el = document.createElement('iframe')
        el.src = browser.runtime.getURL('/recorder-sink.html')
        el.setAttribute('aria-hidden', 'true')
        el.tabIndex = -1
        el.style.cssText =
          'position:fixed!important;width:0!important;height:0!important;border:0!important;opacity:0!important;pointer-events:none!important'
        const timer = setTimeout(() => {
          release()
          reject(new Error('RecorderSinkUnavailable: the storage frame did not load'))
        }, SINK_TIMEOUT_MS)
        el.addEventListener(
          'load',
          () => {
            const channel = new MessageChannel()
            channel.port1.onmessage = ({ data }: MessageEvent<{ ready?: boolean }>) => {
              if (!data?.ready) return
              clearTimeout(timer)
              sink = new RemoteRecordingSink(channel.port1)
              resolve()
            }
            el.contentWindow?.postMessage({ type: SINK_HELLO, token }, new URL(el.src).origin, [
              channel.port2,
            ])
          },
          { once: true },
        )
        frame = el
        document.documentElement.append(el)
      })

    onMessage('page:prepare', async ({ data: token }) => {
      if (busy()) return false
      await prepare(token)
      return true
    })
    onMessage('page:release', () => {
      if (!busy() || armed) release()
    })
    onMessage('page:arm', ({ data }) => {
      if (!sink) throw new Error('RecorderSinkUnavailable: storage frame not ready')
      armed = data
      clearTimeout(armTimer)
      armTimer = setTimeout(() => {
        if (armed) fail(new CaptureCancelledError())
      }, ARM_TIMEOUT_MS)
      return { state: 'starting' as const, awaitingSource: true }
    })

    /**
     * 选择框结果出来后开始录制。用的是后台 page:arm 交来的设置和 page:prepare 嵌好的存储 iframe；
     * 等待期间被取消 / 超时（armed 已清空）时放掉取到的流
     */
    const record = async (opening: ReturnType<typeof openDisplaySource>) => {
      const options = armed
      const remote = sink
      if (!options || !remote || picking) {
        void opening.then(({ stream }) => stream.getTracks().forEach((track) => track.stop()))
        throw new CaptureCancelledError()
      }
      armed = undefined
      clearTimeout(armTimer)
      picking = true
      const requested = options.sourceAudioRequested ?? options.sourceAudio
      const selected = await opening
      const sourceAudio = selected.stream.getAudioTracks().some((t) => t.readyState === 'live')
      const recorder = new RecorderController({
        store: remote,
        media: {
          ...browserMediaBackend,
          capture: (request) => mixCapturedStream(request, selected.stream),
          availableBytes: () => remote.availableBytes(),
        },
        onFinished: ({ meeting, ...result }) => {
          void sendMessage('recordingFinished', { ...result, saved: meeting !== undefined })
            .catch((e: unknown) => console.error('[huilu] failed to notify background', e))
            .finally(() => {
              if (controller === recorder) release()
            })
        },
      })
      controller = recorder
      try {
        // 实际是否有来源声音以取到的音轨为准；要了却没有（选择框里没打开声音开关）时 mixCapturedStream 拒绝开始
        const status = await recorder.start({
          ...options,
          source: selected.source,
          streamId: 'display-media',
          sourceAudio,
          sourceAudioRequested: requested,
        })
        picking = false
        await sendMessage('pageRecordingStarted', status)
      } catch (error) {
        selected.stream.getTracks().forEach((track) => track.stop())
        throw error
      }
    }

    /** 由录制面板的点击同步调用：getDisplayMedia 必须是这个调用栈里的第一个 await */
    const chooseSource = () => {
      const options = armed
      if (!options || !sink || picking) return
      const opening = openDisplaySource(
        options.sourceAudioRequested ?? options.sourceAudio,
        options.mode === 'video' ? options.quality : null,
      )
      void record(opening).catch(fail)
    }

    /** 点「选择来源并开始」后、后台准备好之前：选择框已经开着，状态里不再提示点「选择来源」 */
    let pickerOpen = false

    /**
     * 网页面板上的「选择来源并开始」：先在点击里弹出选择框，再请后台嵌好存储 iframe、交来录制设置。
     * 两边都好了才开始录制，用户选得再快也不会早于后台准备
     */
    const startWithPicker: PageCaptureControls['startWithPicker'] = (request) => {
      const prefs = request.settings?.prefs
      const opening = openDisplaySource(
        prefs?.sourceAudio !== false,
        request.settings?.mode === 'video' && prefs ? prefs.quality : null,
      )
      // 先接住：后台准备失败时选择框的结果没人等，不能变成未处理的拒绝
      opening.catch(() => {})
      pickerOpen = true
      return (async () => {
        try {
          await sendMessage('startRecording', { ...request, pagePicker: true })
        } catch (error) {
          void opening.then(({ stream }) => stream.getTracks().forEach((track) => track.stop()))
          throw error
        } finally {
          pickerOpen = false
        }
        await record(opening).catch((error: unknown) => {
          fail(error)
          throw error
        })
      })()
    }

    registerPageCapture({
      chooseSource,
      startWithPicker,
      cancel: () => {
        if (armed) fail(new CaptureCancelledError())
      },
    })

    const idle = () => ({ state: 'idle' as const })
    onMessage('page:pause', () => controller?.pause() ?? idle())
    onMessage('page:resume', () => controller?.resume() ?? idle())
    onMessage('page:stop', async () => {
      if (armed) {
        fail(new CaptureCancelledError())
        return idle()
      }
      return controller ? controller.stop() : idle()
    })
    onMessage('page:status', () => {
      if (armed && pickerOpen) return { state: 'starting' as const }
      if (armed) return { state: 'starting' as const, awaitingSource: true }
      if (picking && !controller) return { state: 'starting' as const }
      return controller?.status() ?? idle()
    })

    // 录制中离开网页会中断录制：浏览器会先询问一次
    window.addEventListener('beforeunload', (event) => {
      const state = controller?.status().state
      if (state && state !== 'idle') event.preventDefault()
    })
  },
})
