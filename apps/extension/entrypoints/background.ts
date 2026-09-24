import { browser, defineBackground, storage, type Browser } from '#imports'
import { RecorderBusyError } from '@huilu/recorder'
import {
  onMessage,
  sendMessage,
  type LastRecording,
  type RecorderStatus,
  type StartRecordingRequest,
} from '@/lib/messaging'
import { onboardedSetting, recordingModeSetting, recordingPrefsSetting } from '@/lib/settings'
import { openAppPage } from '@/platform'
import { requestCapture } from '@/platform/capture'
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

async function recorderStatus(): Promise<RecorderStatus & { startError?: string }> {
  const last = (await lastRecording.getValue()) ?? undefined
  const startError = (await lastStartError.getValue()) ?? undefined
  if (!(await hasOffscreenDocument())) return { state: 'idle', lastResult: last, startError }
  const status = await sendMessage('offscreen:status')
  return { ...status, lastResult: status.lastResult ?? last, startError }
}

async function startRecording({ tabId, title }: StartRecordingRequest): Promise<RecorderStatus> {
  if (startPending) throw new RecorderBusyError('A recording is already starting')
  startPending = true
  try {
    if ((await recorderStatus()).state !== 'idle') {
      throw new RecorderBusyError('A recording is already in progress')
    }
    const [mode, prefs] = await Promise.all([
      recordingModeSetting.getValue(),
      recordingPrefsSetting.getValue(),
    ])
    const grant = await requestCapture(prefs.videoSource, tabId)
    const status = await exclusive(async () => {
      await ensureOffscreenDocument()
      return sendMessage('offscreen:start', {
        title,
        mode,
        source: prefs.videoSource,
        streamId: grant.streamId,
        sourceAudio: grant.sourceAudio,
        quality: prefs.quality,
        microphone: { enabled: prefs.microphone, deviceId: prefs.microphoneDeviceId },
        language: prefs.language,
      })
    })
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
  onMessage('pauseRecording', async () => {
    const status = await sendMessage('offscreen:pause')
    await updateBadge(status)
    return status
  })
  onMessage('resumeRecording', async () => {
    const status = await sendMessage('offscreen:resume')
    await updateBadge(status)
    return status
  })
  onMessage('stopRecording', async () => {
    if (!(await hasOffscreenDocument())) return recorderStatus()
    const status = await sendMessage('offscreen:stop')
    await updateBadge(status)
    return status
  })
  onMessage('listUnfinishedRecordings', () =>
    withOffscreen(() => sendMessage('offscreen:listUnfinished')),
  )
  onMessage('recoverRecording', ({ data: id }) =>
    withOffscreen(async () => ({ saved: (await sendMessage('offscreen:recover', id)) !== null })),
  )
  onMessage('discardRecording', ({ data: id }) =>
    withOffscreen(() => sendMessage('offscreen:discard', id)),
  )
  onMessage('openApp', ({ data }) => openAppPage(data))

  onMessage('recordingFinished', async ({ data }) => {
    await lastRecording.setValue(data)
    await updateBadge({ state: 'idle' })
    await closeOffscreenIfIdle()
  })

  // 快捷键 Alt+Shift+R：没在录就按上次的设置录当前标签页，在录就结束
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-recording') return
    // 打开侧边栏必须在用户操作的同步调用栈里
    if (tab?.windowId !== undefined) void browser.sidePanel.open({ windowId: tab.windowId })
    toggleRecording(tab).catch((e: unknown) => console.error('[huilu] toggle recording failed', e))
  })
})
