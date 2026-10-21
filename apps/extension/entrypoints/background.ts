import { claimResultNotification, releaseResultNotification } from '@huilu/storage'
import { browser, defineBackground, storage, type Browser } from '#imports'
import type { RecordingMode } from '@huilu/core'
import { IdbJobStore, isActive } from '@huilu/pipeline/jobs'
import { RecorderBusyError } from '@huilu/recorder'
import {
  onMessage,
  sendMessage,
  type LastRecording,
  type RecorderStatus,
  type StartRecordingRequest,
  type WindowRecordingOptions,
} from '@/lib/messaging'
import { PANEL_VIEW_KEY, POPUP_PORT, type PanelView } from '@/lib/page-capture'
import { checkReadiness } from '@/lib/readiness-check'
import {
  dataFolderAuthorizedSetting,
  llmSetting,
  onboardedSetting,
  recordingModeSetting,
  recordingPrefsSetting,
  transcriptionSetting,
} from '@/lib/settings'
import { hasHostPermission, openAppPage } from '@/platform'
import { CaptureCancelledError, requestTabCapture } from '@/platform/capture'
import { syncCodingPlanHeaders } from '@/platform/coding-plan-headers'
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
 * 统一来源选择优先在发起录制的网页里进行（kind = page，见 entrypoints/capture.content）；
 * 网页不能注入时退回可见的采集标签页（kind 为空或 tab，见 entrypoints/recorder），选源后切回原网页。
 * Service Worker 随时可能被回收，所以记在 session 存储里；为空表示录制在离屏文档。
 */
interface RecorderHost {
  kind?: 'tab' | 'page'
  tabId: number
  title: string
  mode: RecordingMode
  /** 选择框结束、录制已开始；之前关闭窗口算取消选择，之后关闭算录制中断 */
  started: boolean
}
const recorderHost = storage.defineItem<RecorderHost | null>('session:recorderTab', {
  fallback: null,
})

/**
 * 录制已结束、正在延迟关闭的采集标签页。它的页面仍注册着 window:* 消息处理，
 * 关掉之前不能开始新的窗口录制，否则广播的 window:start 会被新旧两个窗口同时响应（PR #6 审查 r4118276873）
 */
const retiredTab = storage.defineItem<number | null>('session:retiredRecorderTab', {
  fallback: null,
})

/** page:prepare 时下发给存储 iframe 的一次性令牌，iframe 用它向后台证明端口来自我们的内容脚本 */
const sinkToken = storage.defineItem<{ tabId: number; token: string } | null>(
  'session:recorderSinkToken',
  { fallback: null },
)

/** 立即关闭已结束的采集标签页（如果还开着） */
async function closeRetiredTab() {
  const tabId = await retiredTab.getValue()
  if (tabId === null) return
  await browser.tabs.remove(tabId).catch(() => {})
  await retiredTab.setValue(null)
}

/**
 * 采集标签页已不存在时的收尾，tabs.onRemoved 和状态查询都可能先发现，所以串行执行、按 tabId 比较后再清：
 * 已开始的录制记为「录制窗口被关闭」中断并清掉 REC 角标；还在选择框阶段的由 startInTab 自己处理
 */
let hostQueue: Promise<unknown> = Promise.resolve()
function recorderTabGone(tabId: number): Promise<void> {
  const run = hostQueue.then(async () => {
    const host = await recorderHost.getValue()
    if (host?.tabId !== tabId) return
    // 页面内录制还在等用户选源时网页就没了：没有录到任何东西，只清掉记录
    if (host.kind === 'page' && !host.started) return recorderHost.setValue(null)
    if (!host.started) return
    await recorderHost.setValue(null)
    await lastRecording.setValue({
      id: '',
      title: host.title,
      mode: host.mode,
      endReason: 'error',
      durationMs: 0,
      bytes: 0,
      error: host.kind === 'page' ? 'RecorderPageClosed' : 'RecorderWindowClosed',
      saved: false,
    })
    await updateBadge({ state: 'idle' })
  })
  hostQueue = run.catch(() => {})
  return run
}

/**
 * 采集标签页还开着时返回它。窗口已不存在时不能只清掉记录：状态轮询可能先于 onRemoved 发现，
 * 直接清掉会让 onRemoved 看不到这次中断（PR #6 审查 r4118276865），所以同样走 recorderTabGone
 */
async function activeRecorderHost(): Promise<RecorderHost | undefined> {
  const host = await recorderHost.getValue()
  if (!host) return undefined
  try {
    await browser.tabs.get(host.tabId)
    return host
  } catch {
    await recorderTabGone(host.tabId)
    return undefined
  }
}

type Control = 'pause' | 'resume' | 'stop' | 'status'
/**
 * 网页里的内容脚本已不存在（刷新 / 跳转后旧页面连同录制一起没了）。
 * 新页面里没有接收方时 Chrome 报 Receiving end does not exist；有其他内容脚本（如悬浮面板）
 * 但没人处理 page:* 时，消息库报 No response
 */
function isConnectionError(error: unknown) {
  return /Receiving end does not exist|Could not establish connection|No response/i.test(
    String(error),
  )
}

/** 把暂停 / 继续 / 结束 / 状态转给正在录制的地方；两边都没有时返回 undefined */
async function control(action: Control): Promise<RecorderStatus | undefined> {
  const host = await activeRecorderHost()
  if (host?.kind === 'page') {
    try {
      return await sendMessage(`page:${action}`, undefined, host.tabId)
    } catch (error) {
      if (!isConnectionError(error)) throw error
      await recorderTabGone(host.tabId)
      return undefined
    }
  }
  if (host) return sendMessage(`window:${action}`)
  if (await hasOffscreenDocument()) return sendMessage(`offscreen:${action}`)
  return undefined
}

async function recorderStatus(): Promise<RecorderStatus & { startError?: string }> {
  // 先查状态：发现录制宿主已经没了时，control 会先把这次中断记进 lastRecording
  const status = await control('status')
  const last = (await lastRecording.getValue()) ?? undefined
  const startError = (await lastStartError.getValue()) ?? undefined
  // 最近一次结果只以后台保存的为准（recordingFinished 时写入），这样「知道了」之后不会被
  // 离屏文档 / 录制窗口里残留的结果重新带回来
  if (!status) return { state: 'idle', lastResult: last, startError }
  return { ...status, lastResult: last, startError }
}

/** 用户已看过最近一次的结果 / 开始失败提示：清掉，之后弹窗和悬浮面板不再显示 */
async function dismissNotice() {
  await lastRecording.setValue(null)
  await lastStartError.setValue(null)
}

let resolveWindowReady: (() => void) | undefined

/** Open a visible capture tab in the initiating browser, never a standalone popup. */
async function openRecorderTab(sourceTabId: number): Promise<number> {
  const source = await browser.tabs.get(sourceTabId)
  let readyTimer: ReturnType<typeof setTimeout>
  const ready = new Promise<void>((resolve, reject) => {
    resolveWindowReady = resolve
    readyTimer = setTimeout(() => reject(new Error('The recording tab did not load')), 15_000)
  })
  let hostTabId: number | undefined
  try {
    const tab = await browser.tabs.create({
      url: browser.runtime.getURL('/recorder.html'),
      windowId: source.windowId,
      active: true,
    })
    hostTabId = tab.id
    if (hostTabId === undefined) throw new Error('Could not open the recording tab')
    await ready
    return hostTabId
  } catch (error) {
    if (hostTabId !== undefined) await browser.tabs.remove(hostTabId).catch(() => {})
    throw error
  } finally {
    clearTimeout(readyTimer!)
    resolveWindowReady = undefined
  }
}

async function startInTab(options: WindowRecordingOptions, tabId: number): Promise<RecorderStatus> {
  await closeRetiredTab()
  const hostTabId = await openRecorderTab(tabId)
  const host = { tabId: hostTabId, title: options.title, mode: options.mode, started: false }
  await recorderHost.setValue(host)
  try {
    const status = await sendMessage('window:start', options)
    await recorderHost.setValue({ ...host, started: true })
    return status
  } catch (error) {
    // A disconnected message port can precede tabs.onRemoved; allow Chrome to finish removal.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const closedByUser = !(await browser.tabs.get(hostTabId).then(
      () => true,
      () => false,
    ))
    await recorderHost.setValue(null)
    await browser.tabs.remove(hostTabId).catch(() => {})
    if (closedByUser) throw new CaptureCancelledError()
    throw error
  } finally {
    // Restore the user's page, keeping the capture document alive and inactive.
    await browser.tabs.update(tabId, { active: true }).catch(() => {})
  }
}

function isSecurePage(url: string) {
  const { protocol, hostname } = new URL(url)
  return (
    protocol === 'https:' ||
    (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
  )
}

/**
 * 在发起录制的网页里录：注入内容脚本、嵌好存储 iframe，把录制设置交给网页（page:arm）。
 * 之后由用户在网页的录制面板上点「选择来源」，结果通过 pageRecordingStarted / Failed 报回来。
 * 网页不允许注入（chrome:// 等）或存储 iframe 加载不了时返回 undefined，由调用方退回采集标签页
 */
async function startInPage(
  options: WindowRecordingOptions,
  tabId: number,
): Promise<RecorderStatus | undefined> {
  // getDisplayMedia 只能在安全来源（HTTPS / localhost）的网页里用，否则退回采集标签页
  const { url } = await browser.tabs.get(tabId)
  if (!url || !isSecurePage(url)) return undefined
  const token = crypto.randomUUID()
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/capture.js'],
    })
    await sinkToken.setValue({ tabId, token })
    if (!(await sendMessage('page:prepare', token, tabId))) {
      throw new RecorderBusyError('A recording is already running in this page')
    }
  } catch (e) {
    if (e instanceof RecorderBusyError) throw e
    console.warn('[huilu] cannot record inside this page; using a capture tab', e)
    await sendMessage('page:release', undefined, tabId).catch(() => {})
    return undefined
  } finally {
    await sinkToken.setValue(null)
  }

  const host: RecorderHost = {
    kind: 'page',
    tabId,
    title: options.title,
    mode: options.mode,
    started: false,
  }
  await recorderHost.setValue(host)
  try {
    return await sendMessage('page:arm', options, tabId)
  } catch (error) {
    await recorderHost.setValue(null)
    await sendMessage('page:release', undefined, tabId).catch(() => {})
    throw error
  }
}

/**
 * fromTab：请求来自哪个网页的面板。面板已经在那个网页上，开始后不再重新注入（会丢掉面板状态）；
 * 请求没带 tabId 时就录这个网页
 */
async function startRecording(
  { tabId: requestedTab, title, settings, pagePicker }: StartRecordingRequest,
  fromTab?: number,
): Promise<RecorderStatus & { panelShown: boolean }> {
  const tabId = requestedTab ?? fromTab
  if (tabId === undefined) throw new Error('No tab to record')
  if (startPending) throw new RecorderBusyError('A recording is already starting')
  startPending = true
  try {
    if ((await recorderStatus()).state !== 'idle') {
      throw new RecorderBusyError('A recording is already in progress')
    }
    const savedPrefs = settings ? undefined : await recordingPrefsSetting.getValue()
    const { mode, prefs } = settings ?? {
      mode: await recordingModeSetting.getValue(),
      prefs: { ...savedPrefs!, sourceSelection: savedPrefs!.sourceSelection ?? 'choose' },
    }
    const options: WindowRecordingOptions = {
      title,
      mode,
      source: prefs.sourceSelection === 'current-tab' ? 'tab' : prefs.videoSource,
      chooseSource: prefs.sourceSelection === 'choose',
      sourceAudio: prefs.sourceAudio !== false,
      sourceAudioRequested: prefs.sourceAudio !== false,
      quality: prefs.quality,
      microphone: { enabled: prefs.microphone, deviceId: prefs.microphoneDeviceId },
      language: prefs.language,
    }
    let status: RecorderStatus
    if (!options.chooseSource && options.source === 'tab') {
      const grant = await requestTabCapture(tabId, options.sourceAudio)
      status = await exclusive(async () => {
        await ensureOffscreenDocument()
        try {
          return await sendMessage('offscreen:start', { ...options, ...grant })
        } catch (e) {
          // 开始失败不会有 recordingFinished：在同一个串行步骤里关掉刚创建的空闲离屏文档（PR #6 审查 r4118276860）
          await closeIdleOffscreen().catch(() => {})
          throw e
        }
      })
    } else if (pagePicker) {
      // 网页面板已经弹出了选择框：只能在这个网页里录，不能再开采集标签页
      const inPage = await startInPage(options, tabId)
      if (!inPage) throw new Error('Cannot record inside this page')
      status = inPage
    } else {
      // 统一来源选择优先在当前网页里录；旧的「指定窗口 / 整个屏幕」设置仍走采集标签页
      const inPage = options.chooseSource ? await startInPage(options, tabId) : undefined
      status = inPage ?? (await startInTab(options, tabId))
    }
    await lastRecording.setValue(null)
    await lastStartError.setValue(null)
    await updateBadge(status)
    // 录制中的计时与控制都在页面内悬浮面板里；从网页面板开始的，面板已经在那里
    const panelShown = fromTab === tabId || (await showPanel(tabId))
    return { ...status, panelShown }
  } catch (e) {
    // 选择器使工具栏弹窗失焦关闭、网页面板可能已被关掉；错误保留到用户下次点图标时查看。
    if (!(e instanceof RecorderBusyError)) {
      await lastStartError.setValue(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    }
    throw e
  } finally {
    startPending = false
  }
}

/**
 * 在标签页里显示页面内面板（entrypoints/overlay.content）。靠 activeTab：
 * 用户刚在这个标签页上点了插件图标 / 按了快捷键才有权限注入；chrome:// 等页面不允许注入。
 * setup 为点图标打开的设置面板：先注入录制内容脚本，面板上「选择来源并开始」的点击才能直接弹出选择框
 */
async function showPanel(tabId: number, view: PanelView = 'recording'): Promise<boolean> {
  try {
    if (view === 'setup') {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/capture.js'],
      })
    }
    await browser.scripting.executeScript({
      target: { tabId },
      func: (key: string, value: PanelView) => {
        ;(globalThis as Record<string, unknown>)[key] = value
      },
      args: [PANEL_VIEW_KEY, view],
    })
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/overlay.js'],
    })
    return true
  } catch (e) {
    console.warn('[huilu] cannot show the recording panel in this tab', e)
    return false
  }
}

/**
 * 点插件图标：在当前网页上打开会录面板（没在录时是设置面板，录制中是录制面板）。
 * 网页放不进面板（chrome://、应用商店、新标签页）或不能弹共享选择框（非 HTTPS）时，退回工具栏弹窗
 */
async function onActionClicked(tab: Browser.tabs.Tab) {
  if (tab.id === undefined) return
  const busy = (await recorderStatus()).state !== 'idle'
  const secure = tab.url !== undefined && isSecurePage(tab.url)
  const shown = busy ? await showPanel(tab.id) : secure && (await showPanel(tab.id, 'setup'))
  if (!shown) await openFallbackPopup(tab.id)
}

/**
 * 退路弹窗：manifest 不设默认弹窗（否则点图标不会触发 onClicked），这里只给这个标签页临时设上再打开。
 * 弹窗关闭（端口断开）后清掉，下次点图标仍先尝试网页面板
 */
async function openFallbackPopup(tabId: number) {
  await browser.action.setPopup({ tabId, popup: 'fallback-popup.html' })
  await popupTab.setValue(tabId)
  try {
    await browser.action.openPopup()
  } catch (e) {
    // openPopup 失败（Chrome 127 之前不对普通插件开放、窗口不在前台等）：
    // 保留这个标签页的弹窗设置，用户再点一次图标就会打开
    console.warn('[huilu] cannot open the fallback popup', e)
  }
}

/** 临时设了退路弹窗的标签页；Service Worker 可能在弹窗打开前被回收，记在 session 存储里 */
const popupTab = storage.defineItem<number | null>('session:fallbackPopupTab', { fallback: null })

function onPopupConnected(port: Browser.runtime.Port) {
  if (port.name !== POPUP_PORT) return
  const tabId = popupTab.getValue()
  port.onDisconnect.addListener(() => {
    void tabId.then(async (id) => {
      if (id === null) return
      await browser.action.setPopup({ tabId: id, popup: '' }).catch(() => {})
      if ((await popupTab.getValue()) === id) await popupTab.setValue(null)
    })
  })
}

async function updateBadge(status: RecorderStatus) {
  const text = status.state === 'recording' ? 'REC' : status.state === 'paused' ? '❚❚' : ''
  await browser.action.setBadgeBackgroundColor({ color: '#dc2626' })
  await browser.action.setBadgeText({ text })
}

/** 正在离屏文档里执行的一次性操作（恢复 / 丢弃 / 列出未完成的录制）：执行期间不能关闭 */
let offscreenTasks = 0

/**
 * 离屏文档没有在录制 / 收尾、没有一次性操作在执行、处理队列也空了时关闭它；只能在 exclusive 里调用。
 * 处理任务（转写 / 纪要 / 写入）在离屏文档里跑，录制结束的清理不能把正在处理的文档关掉
 */
async function closeIdleOffscreen() {
  if (offscreenTasks > 0 || !(await hasOffscreenDocument())) return
  if ((await sendMessage('offscreen:status')).state !== 'idle') return
  if (await sendMessage('offscreen:processingBusy')) return
  // 上面的异步查询期间可能刚收到结果通知。
  if (offscreenTasks > 0) return
  await closeOffscreenDocument()
}

/** 没有在录制、也没有正在开始的录制时关闭离屏文档，释放采集设备和内存 */
function scheduleOffscreenCleanup() {
  // 消息响应先交回 Chrome；不能在 processingIdle / recordingFinished 的响应内关闭发送方。
  setTimeout(() => void closeOffscreenIfIdle().catch(logProcessingError), 0)
}

function closeOffscreenIfIdle() {
  return exclusive(async () => {
    if (!startPending) await closeIdleOffscreen()
  })
}

/** 恢复 / 丢弃未完成录制等一次性操作：需要时临时打开离屏文档，用完后如空闲则关闭 */
async function withOffscreen<T>(task: () => Promise<T>): Promise<T> {
  await exclusive(async () => {
    await ensureOffscreenDocument()
    offscreenTasks++
  })
  try {
    return await task()
  } finally {
    offscreenTasks--
    scheduleOffscreenCleanup()
  }
}

/** 处理任务只读地看一眼（写入只在离屏文档）：判断是否需要唤醒离屏文档 */
const jobs = new IdbJobStore()

async function hasJobs(filter: (job: Awaited<ReturnType<typeof jobs.list>>[number]) => boolean) {
  try {
    return (await jobs.list()).some(filter)
  } catch (e) {
    console.warn('[huilu] cannot read processing jobs; waking recovery', e)
    return true
  }
}

/** 把会议交给离屏文档里的处理队列；auto 为录制结束 / 恢复后的自动加入（未配置转写服务时不加入） */
function processMeeting(meetingId: string, auto = false) {
  return withOffscreen(async () => {
    const result = await sendMessage('offscreen:process', { meetingId, auto })
    return result ?? { queued: false as const, reason: 'meetingNotFound' as const }
  })
}

/**
 * 有排队 / 中断 / 等待授权的处理任务时打开离屏文档，队列会查询实际文件夹权限并恢复（不会弹出授权）。
 * Service Worker 每次启动、浏览器启动时都检查一次；没有任务时什么都不做
 */
async function resumeProcessing() {
  if (!(await hasJobs((j) => isActive(j) || j.state === 'waitingFolder'))) return
  await withOffscreen(() => sendMessage('offscreen:process', {}))
}

/** 数据文件夹在可见页面重新授权后：补写等待写入的任务 */
async function onFolderAuthorized() {
  if (!(await hasJobs((j) => j.state === 'waitingFolder'))) return
  await withOffscreen(() => sendMessage('offscreen:folderAuthorized'))
}

async function toggleRecording(tab: Browser.tabs.Tab | undefined) {
  const status = await recorderStatus()
  if (status.state === 'recording' || status.state === 'paused') {
    // 转给实际在录的地方：标签页录制在离屏文档，窗口 / 屏幕录制在录制窗口
    const stopped = await control('stop')
    if (stopped) await updateBadge(stopped)
    return
  }
  if (tab?.id === undefined) return
  await startRecording({ tabId: tab.id, title: tab.title ?? '' })
}

/** 同一会议的并发通知共用一次投递；丢失响应后重试仍由持久 claim 去重。 */
const resultNotifications = new Map<string, Promise<void>>()
function notifyProcessingCompleted(id: string): Promise<void> {
  const pending = resultNotifications.get(id)
  if (pending) return pending
  // 从收到消息到页面打开完成，所有空闲清理都必须保留发送方。
  offscreenTasks++
  const task = (async () => {
    if ((await jobs.get(id))?.state !== 'done') return
    if (!(await claimResultNotification(id))) return
    try {
      const route = `/meeting/${encodeURIComponent(id)}`
      const url = browser.runtime.getURL(`/app.html#${route}`)
      const existing = (await browser.tabs.query({})).find((tab) => tab.url === url)
      if (existing?.id !== undefined) {
        try {
          await browser.tabs.update(existing.id, { active: true })
        } catch (error) {
          // 用户刚关掉结果页：重新打开；其他更新失败保留诊断并允许重试。
          if (!/No tab with id/i.test(String(error))) throw error
          await openAppPage(route)
        }
      } else await openAppPage(route)
    } catch (error) {
      // 页面尚未成功打开就失败，不能永久消耗通知名额。
      await releaseResultNotification(id)
      throw error
    }
  })().finally(() => {
    offscreenTasks--
    resultNotifications.delete(id)
    scheduleOffscreenCleanup()
  })
  resultNotifications.set(id, task)
  return task
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
  onMessage('startRecording', ({ data, sender }) => startRecording(data, sender.tab?.id))
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
  onMessage('pageRecordingStarted', async ({ data: status, sender }) => {
    const host = await recorderHost.getValue()
    if (host?.kind !== 'page' || host.tabId !== sender.tab?.id) return
    await recorderHost.setValue({ ...host, started: true })
    await lastStartError.setValue(null)
    await updateBadge(status)
  })
  onMessage('pageRecordingFailed', async ({ data: error, sender }) => {
    const host = await recorderHost.getValue()
    if (host?.kind !== 'page' || host.tabId !== sender.tab?.id || host.started) return
    await recorderHost.setValue(null)
    // 网页面板会就地显示；面板被关掉或在弹窗里开始的，原因留到下次点图标时查看
    await lastStartError.setValue(error)
    await updateBadge({ state: 'idle' })
  })
  onMessage('verifyRecorderSink', async ({ data: token, sender }) => {
    const expected = await sinkToken.getValue()
    if (!expected || expected.tabId !== sender.tab?.id || expected.token !== token) return false
    // 一次性：同一网页里后来嵌入的其他存储 iframe 不能再用它
    await sinkToken.setValue(null)
    return true
  })
  // 录制窗口里的录制还没收尾：它在 OPFS 中看起来和「未完成的录制」一样，不能拿去恢复 / 丢弃
  onMessage('listUnfinishedRecordings', async () =>
    (await activeRecorderHost())
      ? []
      : withOffscreen(() => sendMessage('offscreen:listUnfinished')),
  )
  onMessage('recoverRecording', async ({ data: id }) => {
    const saved = await withOffscreen(
      async () => (await sendMessage('offscreen:recover', id)) !== null,
    )
    // 恢复出来的录制与正常结束的一样进入处理队列（只剩视频的不会加入）
    if (saved) void processMeeting(id, true).catch(logProcessingError)
    return { saved }
  })
  onMessage('discardRecording', ({ data: id }) =>
    withOffscreen(() => sendMessage('offscreen:discard', id)),
  )
  onMessage('openApp', ({ data }) => openAppPage(data))
  onMessage('dismissRecordingNotice', () => dismissNotice())
  onMessage('getReadiness', () =>
    checkReadiness(() => withOffscreen(() => sendMessage('offscreen:folderStatus'))),
  )
  onMessage('getMicrophonePermission', () =>
    withOffscreen(() => sendMessage('offscreen:microphonePermission')),
  )
  onMessage('processMeeting', ({ data: id }) => processMeeting(id))

  // 离屏文档里的处理队列需要的平台能力。每一步开始前都会来取设置：
  // 先按同一份设置同步 Coding Plan 请求头规则，保证发出的请求与所用配置一致
  onMessage('processingSettings', async () => {
    await syncCodingPlanHeaders().catch(logHeaderRuleError)
    return {
      transcription: await transcriptionSetting.getValue(),
      llm: await llmSetting.getValue(),
    }
  })
  onMessage('processingHasHostPermission', ({ data: url }) => hasHostPermission(url))
  onMessage('processingIdle', () => scheduleOffscreenCleanup())
  onMessage('processingCompleted', ({ data: id }) => notifyProcessingCompleted(id))

  onMessage('recordingFinished', async ({ data, sender }) => {
    await lastRecording.setValue(data)
    await updateBadge({ state: 'idle' })
    // 有 meeting.json 的录制交给处理队列（离屏文档）；窗口录制结束时离屏文档可能还没打开
    if (data.saved && data.id) void processMeeting(data.id, true).catch(logProcessingError)
    const host = await recorderHost.getValue()
    if (host?.kind === 'page' && sender.tab?.id === host.tabId) {
      // 页面内录制：网页是用户自己的，不关闭；内容脚本自己移除存储 iframe
      await recorderHost.setValue(null)
      scheduleOffscreenCleanup()
      return
    }
    if (host && sender.tab?.id === host.tabId) {
      // 录制窗口的使命完成：先清记录再关窗口，onRemoved 就不会当成「中途被关闭」。
      // 稍后再关；这期间记为 retiredTab，新的窗口录制开始前会先把它关掉
      await retiredTab.setValue(host.tabId)
      await recorderHost.setValue(null)
      setTimeout(() => void closeRetiredTab(), 1500)
      return
    }
    scheduleOffscreenCleanup()
  })

  // GLM Coding Plan 请求头规则（实验）：启动 / 安装升级 / 设置变化时按已保存的设置同步
  void syncCodingPlanHeaders().catch(logHeaderRuleError)
  llmSetting.watch(() => void syncCodingPlanHeaders().catch(logHeaderRuleError))

  // 浏览器重启 / Service Worker 被唤醒：继续没做完的处理任务
  browser.runtime.onStartup.addListener(() => void resumeProcessing())
  void resumeProcessing()
  dataFolderAuthorizedSetting.watch(() => void onFolderAuthorized().catch(logProcessingError))

  // 录制中用户直接关掉了录制窗口 / 录制的网页：录制中断，数据留在 OPFS，可在「未完成的录制」里恢复
  browser.tabs.onRemoved.addListener((tabId) => {
    void recorderTabGone(tabId)
  })
  // 页面内录制的网页刷新 / 跳转：旧页面连同录制一起没了。新页面加载完后查一次，
  // 联系不上内容脚本就记为中断（control 里处理），不必等弹窗或面板来轮询
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'complete') return
    void recorderHost.getValue().then((host) => {
      if (host?.kind === 'page' && host.started && host.tabId === tabId) void control('status')
    })
  })

  // 点插件图标：在当前网页上打开会录面板，不能注入的页面退回工具栏弹窗
  browser.action.onClicked.addListener((tab) => {
    onActionClicked(tab).catch((e: unknown) => console.error('[huilu] open panel failed', e))
  })
  browser.runtime.onConnect.addListener(onPopupConnected)

  // 快捷键 Alt+Shift+R：没在录就按上次的设置录当前标签页，在录就结束
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-recording') return
    toggleRecording(tab).catch((e: unknown) => console.error('[huilu] toggle recording failed', e))
  })
})

function logHeaderRuleError(e: unknown) {
  console.error('[huilu] failed to sync coding plan header rules', e)
}

function logProcessingError(e: unknown) {
  console.error('[huilu] processing request failed', e)
}
