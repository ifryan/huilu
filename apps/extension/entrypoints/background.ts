import { browser, defineBackground, storage, type Browser } from '#imports'
import type { RecordingMode } from '@huilu/core'
import { RecorderBusyError } from '@huilu/recorder'
import {
  onMessage,
  sendMessage,
  type LastRecording,
  type RecorderStatus,
  type StartRecordingRequest,
  type WindowRecordingOptions,
} from '@/lib/messaging'
import { onboardedSetting, recordingModeSetting, recordingPrefsSetting } from '@/lib/settings'
import { openAppPage } from '@/platform'
import { CaptureCancelledError, requestTabCapture } from '@/platform/capture'
import {
  closeOffscreenDocument,
  ensureOffscreenDocument,
  hasOffscreenDocument,
} from '@/platform/offscreen'

/** 离屏文档关闭后，侧边栏仍要能显示「录制已保存 / 已中断」，所以放在 session 存储里 */
const lastRecording = storage.defineItem<LastRecording | null>('session:lastRecording', {
  fallback: null,
})

/** 快捷键 / 窗口选择框场景下开始录制失败时没有弹窗可以显示错误，记下来给侧边栏显示 */
const lastStartError = storage.defineItem<string | null>('session:lastStartError', {
  fallback: null,
})

/**
 * 离屏文档的创建 / 关闭与开始录制串行执行：
 * 否则「录制刚结束、正在关闭离屏文档」时再点开始，新录制会随文档一起被关掉。
 */
let lifecycle: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = lifecycle.then(task)
  lifecycle = run.catch(() => {})
  return run
}

/** 后台层面的开始录制互斥：覆盖「窗口 / 屏幕选择框还开着」这段离屏文档还不知道的时间 */
let startPending = false

/**
 * 窗口 / 屏幕录制在一个可见的录制窗口里进行（见 entrypoints/recorder）。
 * Service Worker 随时可能被回收，所以记在 session 存储里；为空表示录制在离屏文档（标签页）。
 */
interface WindowHost {
  windowId: number
  title: string
  mode: RecordingMode
  /** 选择框结束、录制已开始；之前关闭窗口算取消选择，之后关闭算录制中断 */
  started: boolean
}
const windowHost = storage.defineItem<WindowHost | null>('session:recorderWindow', {
  fallback: null,
})

/** 录制窗口还开着时返回它；窗口已不存在则清掉记录 */
async function activeWindowHost(): Promise<WindowHost | undefined> {
  const host = await windowHost.getValue()
  if (!host) return undefined
  try {
    await browser.windows.get(host.windowId)
    return host
  } catch {
    await windowHost.setValue(null)
    return undefined
  }
}

type Control = 'pause' | 'resume' | 'stop' | 'status'
/** 把暂停 / 继续 / 结束 / 状态转给正在录制的地方；两边都没有时返回 undefined */
async function control(action: Control): Promise<RecorderStatus | undefined> {
  if (await activeWindowHost()) return sendMessage(`window:${action}`)
  if (await hasOffscreenDocument()) return sendMessage(`offscreen:${action}`)
  return undefined
}

async function recorderStatus(): Promise<RecorderStatus & { startError?: string }> {
  const last = (await lastRecording.getValue()) ?? undefined
  const startError = (await lastStartError.getValue()) ?? undefined
  const status = await control('status')
  if (!status) return { state: 'idle', lastResult: last, startError }
  return { ...status, lastResult: status.lastResult ?? last, startError }
}

let resolveWindowReady: (() => void) | undefined

/** 打开录制窗口并等它注册好消息处理 */
async function openRecorderWindow(): Promise<number> {
  const ready = new Promise<void>((resolve, reject) => {
    resolveWindowReady = resolve
    setTimeout(() => reject(new Error('The recording window did not load')), 15_000)
  })
  const win = await browser.windows.create({
    url: browser.runtime.getURL('/recorder.html'),
    type: 'popup',
    width: 420,
    height: 340,
    focused: true,
  })
  const windowId = win?.id
  if (windowId === undefined) throw new Error('Could not open the recording window')
  try {
    await ready
  } catch (e) {
    await browser.windows.remove(windowId).catch(() => {})
    throw e
  }
  return windowId
}

async function startInWindow(options: WindowRecordingOptions): Promise<RecorderStatus> {
  const windowId = await openRecorderWindow()
  const host = { windowId, title: options.title, mode: options.mode, started: false }
  await windowHost.setValue(host)
  try {
    const status = await sendMessage('window:start', options)
    await windowHost.setValue({ ...host, started: true })
    return status
  } catch (e) {
    // 取消选择 / 选择框报错 / 开始失败：关掉窗口，错误交给调用方
    // 窗口关闭时消息通道先断开，窗口稍后才从列表里消失，稍等再判断
    await new Promise((resolve) => setTimeout(resolve, 500))
    const closedByUser = !(await browser.windows.get(windowId).then(
      () => true,
      () => false,
    ))
    await windowHost.setValue(null)
    await browser.windows.remove(windowId).catch(() => {})
    // 选择框开着时用户直接关掉了录制窗口：等同于取消选择
    if (closedByUser) throw new CaptureCancelledError()
    throw e
  }
}

async function startRecording({
  tabId,
  title,
  settings,
}: StartRecordingRequest): Promise<RecorderStatus> {
  if (startPending) throw new RecorderBusyError('A recording is already starting')
  startPending = true
  try {
    if ((await recorderStatus()).state !== 'idle') {
      throw new RecorderBusyError('A recording is already in progress')
    }
    const { mode, prefs } = settings ?? {
      mode: await recordingModeSetting.getValue(),
      prefs: await recordingPrefsSetting.getValue(),
    }
    const options: WindowRecordingOptions = {
      title,
      mode,
      source: prefs.videoSource,
      quality: prefs.quality,
      microphone: { enabled: prefs.microphone, deviceId: prefs.microphoneDeviceId },
      language: prefs.language,
    }
    let status: RecorderStatus
    if (prefs.videoSource === 'tab') {
      const grant = await requestTabCapture(tabId)
      status = await exclusive(async () => {
        await ensureOffscreenDocument()
        return sendMessage('offscreen:start', { ...options, ...grant })
      })
    } else {
      status = await startInWindow(options)
    }
    await lastRecording.setValue(null)
    await lastStartError.setValue(null)
    await updateBadge(status)
    return status
  } catch (e) {
    // 选择窗口 / 屏幕时弹窗通常已经关闭，错误只能留给侧边栏显示
    if (!(e instanceof RecorderBusyError)) {
      await lastStartError.setValue(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    }
    throw e
  } finally {
    startPending = false
  }
}

async function updateBadge(status: RecorderStatus) {
  const text = status.state === 'recording' ? 'REC' : status.state === 'paused' ? '❚❚' : ''
  await browser.action.setBadgeBackgroundColor({ color: '#dc2626' })
  await browser.action.setBadgeText({ text })
}

/** 没有在录制、也没有正在开始的录制时关闭离屏文档，释放采集设备和内存 */
function closeOffscreenIfIdle() {
  return exclusive(async () => {
    if (startPending || !(await hasOffscreenDocument())) return
    if ((await sendMessage('offscreen:status')).state !== 'idle') return
    await closeOffscreenDocument()
  })
}

/** 恢复 / 丢弃未完成录制等一次性操作：需要时临时打开离屏文档，用完后如空闲则关闭 */
async function withOffscreen<T>(task: () => Promise<T>): Promise<T> {
  await exclusive(ensureOffscreenDocument)
  try {
    return await task()
  } finally {
    void closeOffscreenIfIdle()
  }
}

async function toggleRecording(tab: Browser.tabs.Tab | undefined) {
  const status = await recorderStatus()
  if (status.state === 'recording' || status.state === 'paused') {
    await updateBadge(await sendMessage('offscreen:stop'))
    return
  }
  if (tab?.id === undefined) return
  await startRecording({ tabId: tab.id, title: tab.title ?? '' })
}

/**
 * 后台 Service Worker 只做调度，随时可能被浏览器回收；
 * 录制和耗时的处理任务放在离屏文档（entrypoints/offscreen）中执行，录制状态以离屏文档为准。
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install' && !(await onboardedSetting.getValue())) {
      await openAppPage('/onboarding')
    }
  })

  onMessage('getRecorderStatus', () => recorderStatus())
  onMessage('startRecording', ({ data }) => startRecording(data))
  for (const [message, action] of [
    ['pauseRecording', 'pause'],
    ['resumeRecording', 'resume'],
    ['stopRecording', 'stop'],
  ] as const) {
    onMessage(message, async () => {
      const status = await control(action)
      if (!status) return recorderStatus()
      await updateBadge(status)
      return status
    })
  }
  onMessage('recorderWindowReady', () => resolveWindowReady?.())
  // 录制窗口里的录制还没收尾：它在 OPFS 中看起来和「未完成的录制」一样，不能拿去恢复 / 丢弃
  onMessage('listUnfinishedRecordings', async () =>
    (await activeWindowHost()) ? [] : withOffscreen(() => sendMessage('offscreen:listUnfinished')),
  )
  onMessage('recoverRecording', ({ data: id }) =>
    withOffscreen(async () => ({ saved: (await sendMessage('offscreen:recover', id)) !== null })),
  )
  onMessage('discardRecording', ({ data: id }) =>
    withOffscreen(() => sendMessage('offscreen:discard', id)),
  )
  onMessage('openApp', ({ data }) => openAppPage(data))

  onMessage('recordingFinished', async ({ data, sender }) => {
    await lastRecording.setValue(data)
    await updateBadge({ state: 'idle' })
    const host = await windowHost.getValue()
    if (host && sender.tab?.windowId === host.windowId) {
      // 录制窗口的使命完成：先清记录再关窗口，onRemoved 就不会当成「中途被关闭」
      await windowHost.setValue(null)
      setTimeout(() => void browser.windows.remove(host.windowId).catch(() => {}), 1500)
      return
    }
    await closeOffscreenIfIdle()
  })

  // 录制中用户直接关掉了录制窗口：录制中断，数据留在 OPFS，可在「未完成的录制」里恢复
  browser.windows.onRemoved.addListener((windowId) => {
    void windowHost.getValue().then(async (host) => {
      // 还没开始录制（选择框阶段）由 startInWindow 自己处理
      if (host?.windowId !== windowId || !host.started) return
      await windowHost.setValue(null)
      await lastRecording.setValue({
        id: '',
        title: host.title,
        mode: host.mode,
        endReason: 'error',
        durationMs: 0,
        bytes: 0,
        error: 'RecorderWindowClosed',
        saved: false,
      })
      await updateBadge({ state: 'idle' })
    })
  })

  // 快捷键 Alt+Shift+R：没在录就按上次的设置录当前标签页，在录就结束
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-recording') return
    // 打开侧边栏必须在用户操作的同步调用栈里
    if (tab?.windowId !== undefined) void browser.sidePanel.open({ windowId: tab.windowId })
    toggleRecording(tab).catch((e: unknown) => console.error('[huilu] toggle recording failed', e))
  })
})
