// 后台调度的回归测试：fakeBrowser 模拟 chrome.*，离屏文档 / 录制窗口的消息处理用内存里的假实现代替
import type { RecorderStatus } from '@huilu/recorder'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingSettingsSnapshot } from '@/lib/messaging'

type Handler = (message: { data: unknown; sender: { tab?: { windowId?: number } } }) => unknown

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  offscreenOpen: false,
  offscreenState: 'idle' as RecorderStatus['state'],
  offscreenStart: (): Promise<RecorderStatus> => Promise.resolve({ state: 'recording' }),
  closeCalls: 0,
  windowState: 'idle' as RecorderStatus['state'],
  /** 录制窗口页面：只要窗口还开着，广播的 window:* 消息它都会收到 */
  recorderWindows: new Set<number>(),
  /** 每次 window:start 广播时有多少个录制窗口页面会响应 */
  windowStartReceivers: [] as number[],
  /** 离屏文档里的处理队列 */
  processingBusy: false,
  processRequests: [] as unknown[],
  folderAuthorizedCalls: 0,
  /** IndexedDB 中的处理任务（后台只读） */
  jobs: [] as { meetingId: string; state: string }[],
}))

vi.mock('@/lib/messaging', () => ({
  onMessage: (type: string, handler: Handler) => void h.handlers.set(type, handler),
  sendMessage: async (type: string, data?: unknown): Promise<unknown> => {
    switch (type) {
      case 'offscreen:process':
        if (!h.offscreenOpen) throw new Error('Could not establish connection')
        h.processRequests.push(data)
        return { queued: true, job: {} }
      case 'offscreen:processingBusy':
        if (!h.offscreenOpen) throw new Error('Could not establish connection')
        return h.processingBusy
      case 'offscreen:folderAuthorized':
        h.folderAuthorizedCalls++
        return undefined
      case 'offscreen:start':
        if (!h.offscreenOpen) throw new Error('Could not establish connection')
        return h.offscreenStart()
      case 'offscreen:status':
        if (!h.offscreenOpen) throw new Error('Could not establish connection')
        return { state: h.offscreenState }
      case 'window:start':
        h.windowStartReceivers.push(h.recorderWindows.size)
        h.windowState = 'recording'
        return { state: 'recording' }
      case 'window:status':
        return { state: h.windowState }
      default:
        throw new Error(`unexpected message ${type}`)
    }
  },
}))

vi.mock('@/platform/offscreen', () => ({
  ensureOffscreenDocument: async () => void (h.offscreenOpen = true),
  closeOffscreenDocument: async () => {
    h.closeCalls++
    h.offscreenOpen = false
  },
  hasOffscreenDocument: async () => h.offscreenOpen,
}))

vi.mock('@/platform/capture', () => ({
  CaptureCancelledError: class CaptureCancelledError extends Error {},
  requestTabCapture: async () => ({ streamId: 'tab-stream', sourceAudio: true }),
}))

vi.mock('@/platform', () => ({ openAppPage: async () => {}, hasHostPermission: async () => true }))

vi.mock('@huilu/pipeline/jobs', () => ({
  IdbJobStore: class {
    list = async () => h.jobs
  },
  isActive: (j: { state: string }) => j.state === 'queued' || j.state === 'running',
}))

const { default: background } = await import('@/entrypoints/background')

const settings = (videoSource: 'tab' | 'screen'): RecordingSettingsSnapshot => ({
  mode: 'video',
  prefs: {
    videoSource,
    quality: { resolution: '720p', fps: 15 },
    microphone: false,
    language: 'zh',
  },
})

const call = <T>(type: string, data?: unknown, sender: { tab?: { windowId?: number } } = {}) =>
  Promise.resolve(h.handlers.get(type)!({ data, sender })) as Promise<T>

const start = (videoSource: 'tab' | 'screen') =>
  call<RecorderStatus>('startRecording', {
    tabId: 1,
    title: '评审',
    settings: settings(videoSource),
  })

/** 等后台里 void 掉的异步回调（onRemoved 等）跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  fakeBrowser.reset()
  h.handlers.clear()
  Object.assign(h, {
    offscreenOpen: false,
    offscreenState: 'idle',
    offscreenStart: () => Promise.resolve({ state: 'recording' }),
    closeCalls: 0,
    windowState: 'idle',
    windowStartReceivers: [],
    processingBusy: false,
    processRequests: [],
    folderAuthorizedCalls: 0,
    jobs: [],
  })
  h.recorderWindows.clear()
  // Chrome 的 windows.get 对不存在的窗口会报错（fakeBrowser 返回 undefined）
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation(async (id: number) => {
    const win = (await fakeBrowser.windows.getAll()).find((w) => w.id === id)
    if (!win) throw new Error(`No window with id: ${id}`)
    return win
  })
  // 新开的录制窗口加载完成后报告就绪；关闭后它的消息处理随之消失
  fakeBrowser.windows.onCreated.addListener((win) => {
    h.recorderWindows.add(win.id!)
    void call('recorderWindowReady')
  })
  fakeBrowser.windows.onRemoved.addListener((id) => void h.recorderWindows.delete(id))
  // fakeBrowser 没有实现的 API
  Object.assign(fakeBrowser, {
    scripting: { executeScript: async () => [] },
    commands: { onCommand: { addListener: () => {} } },
  })
  background.main()
})

describe('background recording lifecycle', () => {
  // PR #6 审查 r4118276860
  it('closes the idle offscreen document when a tab recording fails to start', async () => {
    h.offscreenStart = () => Promise.reject(new Error('InsufficientStorageError: full'))
    await expect(start('tab')).rejects.toThrow('full')
    await settle()
    expect(h.offscreenOpen).toBe(false)
    expect(h.closeCalls).toBe(1)
  })

  it('keeps the offscreen document when it is not idle after a failed start', async () => {
    h.offscreenStart = () => {
      // 开始失败时离屏文档仍在收尾之前的录制（不应出现，但不能误关正在处理的宿主）
      h.offscreenState = 'stopping'
      return Promise.reject(new Error('boom'))
    }
    await expect(start('tab')).rejects.toThrow('boom')
    await settle()
    expect(h.offscreenOpen).toBe(true)
    expect(h.closeCalls).toBe(0)
  })

  // PR #6 审查 r4118276865
  it('classifies a closed recorder window as interrupted even if status polling saw it first', async () => {
    await start('screen')
    const [windowId] = [...h.recorderWindows]
    expect(await fakeBrowser.action.getBadgeText({})).toBe('REC')

    // 用户关掉录制窗口：窗口先从列表里消失，状态轮询在 onRemoved 回调之前执行
    vi.mocked(fakeBrowser.windows.get).mockImplementation(async (id: number) => {
      const win = (await fakeBrowser.windows.getAll()).find((w) => w.id === id && id !== windowId)
      if (!win) throw new Error(`No window with id: ${id}`)
      return win
    })
    const polled = await call<RecorderStatus>('getRecorderStatus')
    expect(polled.state).toBe('idle')

    await fakeBrowser.windows.remove(windowId!)
    await settle()
    const status = await call<RecorderStatus>('getRecorderStatus')
    expect(status.lastResult).toMatchObject({ error: 'RecorderWindowClosed', saved: false })
    expect(await fakeBrowser.action.getBadgeText({})).toBe('')
  })

  // PR #6 审查 r4118276873
  it('closes the finished recorder window before a new window recording starts', async () => {
    await start('screen')
    const [first] = [...h.recorderWindows]
    h.windowState = 'idle'
    await call(
      'recordingFinished',
      {
        id: 'r1',
        title: '评审',
        mode: 'video',
        endReason: 'user',
        durationMs: 1000,
        bytes: 10,
        saved: true,
      },
      { tab: { windowId: first } },
    )
    // 旧窗口还在延迟关闭的 1.5 秒内：马上开始下一场
    await start('screen')
    expect(h.windowStartReceivers).toEqual([1, 1])
    expect(h.recorderWindows.has(first!)).toBe(false)
  })
})

const finished = (id: string, saved = true) => ({
  id,
  title: '评审',
  mode: 'audio',
  endReason: 'user',
  durationMs: 1000,
  bytes: 10,
  saved,
})

describe('background processing lifecycle', () => {
  it('queues a finished tab recording and keeps the offscreen document while processing', async () => {
    await start('tab')
    h.offscreenState = 'idle'
    h.processingBusy = true
    await call('recordingFinished', finished('r1'))
    await settle()
    expect(h.processRequests).toEqual([{ meetingId: 'r1', auto: true }])
    // 录制结束的清理不能关掉正在转写的离屏文档
    expect(h.offscreenOpen).toBe(true)
    expect(h.closeCalls).toBe(0)

    // 队列跑完后离屏文档报告空闲：此时才关闭
    h.processingBusy = false
    await call('processingIdle')
    await settle()
    expect(h.offscreenOpen).toBe(false)
  })

  it('opens the offscreen document to process a window recording', async () => {
    await start('screen')
    expect(h.offscreenOpen).toBe(false)
    const [windowId] = [...h.recorderWindows]
    h.processingBusy = true
    await call('recordingFinished', finished('r2'), { tab: { windowId } })
    await settle()
    expect(h.offscreenOpen).toBe(true)
    expect(h.processRequests).toEqual([{ meetingId: 'r2', auto: true }])
  })

  it('does not queue recordings that were not saved', async () => {
    await start('tab')
    await call('recordingFinished', finished('r3', false))
    await settle()
    expect(h.processRequests).toEqual([])
    expect(h.offscreenOpen).toBe(false)
  })

  it('does not close the offscreen document while a recording is running', async () => {
    await start('tab')
    h.offscreenState = 'recording'
    await call('processingIdle')
    await settle()
    expect(h.offscreenOpen).toBe(true)
  })

  it('handles manual processing requests from the history page', async () => {
    h.processingBusy = true
    await expect(call('processMeeting', 'r4')).resolves.toMatchObject({ queued: true })
    expect(h.processRequests).toEqual([{ meetingId: 'r4', auto: false }])
    expect(h.offscreenOpen).toBe(true)
  })

  it('resumes interrupted jobs when the service worker starts', async () => {
    h.jobs = [{ meetingId: 'r5', state: 'running' }]
    h.processingBusy = true
    background.main()
    await settle()
    expect(h.offscreenOpen).toBe(true)
    expect(h.processRequests).toContainEqual({})
  })

  it('stays idle on start when there is nothing to process', async () => {
    h.jobs = [{ meetingId: 'a', state: 'done' }]
    background.main()
    await settle()
    expect(h.offscreenOpen).toBe(false)
  })

  it('wakes waiting jobs on worker startup even without an authorization event', async () => {
    h.jobs = [{ meetingId: 'waiting', state: 'waitingFolder' }]
    background.main()
    await settle()
    expect(h.processRequests).toContainEqual({})
  })

  it('rewrites waiting results after the data folder is re-authorized', async () => {
    const { dataFolderAuthorizedSetting } = await import('@/lib/settings')
    h.jobs = [{ meetingId: 'r6', state: 'waitingFolder' }]
    await dataFolderAuthorizedSetting.setValue({ name: 'HuiLu', at: Date.now() })
    await settle()
    expect(h.folderAuthorizedCalls).toBe(1)
    // 没有在等待写入的任务时，授权变化不用打开离屏文档
    h.jobs = []
    await dataFolderAuthorizedSetting.setValue({ name: 'HuiLu', at: Date.now() + 1 })
    await settle()
    expect(h.folderAuthorizedCalls).toBe(1)
  })
})
