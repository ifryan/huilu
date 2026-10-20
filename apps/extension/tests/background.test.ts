// 后台调度的回归测试：fakeBrowser 模拟 chrome.*，离屏文档 / 录制窗口的消息处理用内存里的假实现代替
import type { RecorderStatus } from '@huilu/recorder'
import type * as StorageModule from '@huilu/storage'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingSettingsSnapshot } from '@/lib/messaging'

type Handler = (message: {
  data: unknown
  sender: { tab?: { windowId?: number; id?: number } }
}) => unknown

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  offscreenOpen: false,
  offscreenState: 'idle' as RecorderStatus['state'],
  offscreenStart: (): Promise<RecorderStatus> => Promise.resolve({ state: 'recording' }),
  closeCalls: 0,
  captureRequests: [] as unknown[],
  releasedClaims: [] as string[],
  openResult: async () => {},
  windowState: 'idle' as RecorderStatus['state'],
  /** 录制窗口页面：只要窗口还开着，广播的 window:* 消息它都会收到 */
  recorderWindows: new Set<number>(),
  /** 每次 window:start 广播时有多少个录制窗口页面会响应 */
  windowStartReceivers: [] as number[],
  /** 离屏文档里的处理队列 */
  processingBusy: false,
  processRequests: [] as unknown[],
  folderAuthorizedCalls: 0,
  resultNotificationClaims: [] as string[],
  openedAppRoutes: [] as string[],
  /** IndexedDB 中的处理任务（后台只读） */
  jobsReadFailures: 0,
  jobs: [] as { meetingId: string; state: string }[],
  /** 页面内录制：网页能否注入、内容脚本是否还在（刷新后消失）、选择框结果 */
  injectFails: false,
  pageUrl: 'https://meet.example.com/abc',
  pageScript: false,
  pageState: 'idle' as RecorderStatus['state'],
  /** 交给网页等待用户选源的录制设置（page:arm） */
  pageStarts: [] as unknown[],
  pageReleases: 0,
  onPrepare: async (_token: unknown) => {},
  /** declarativeNetRequest 会话规则 */
  sessionRules: [] as { id: number; condition: { urlFilter?: string } }[],
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
        h.captureRequests.push(data)
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
      case 'page:prepare':
      case 'page:release':
      case 'page:arm':
      case 'page:status':
      case 'page:stop':
        if (!h.pageScript)
          throw new Error('Could not establish connection. Receiving end does not exist.')
        if (type === 'page:prepare') {
          await h.onPrepare(data)
          return h.pageState === 'idle'
        }
        if (type === 'page:release') return void h.pageReleases++
        if (type === 'page:arm') {
          h.pageStarts.push(data)
          h.pageState = 'starting'
          return { state: 'starting', awaitingSource: true }
        }
        if (type === 'page:stop') h.pageState = 'idle'
        return { state: h.pageState }
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
  requestTabCapture: async (_tabId: number, sourceAudio = true) => ({
    streamId: 'tab-stream',
    sourceAudio,
  }),
}))

vi.mock('@/platform', () => ({
  openAppPage: async (route: string) => {
    await h.openResult()
    h.openedAppRoutes.push(route)
  },
  hasHostPermission: async () => true,
}))

vi.mock('@huilu/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof StorageModule>()),
  releaseResultNotification: async (id: string) => {
    h.releasedClaims.push(id)
  },
  claimResultNotification: async (id: string) => {
    h.resultNotificationClaims.push(id)
    return true
  },
}))

vi.mock('@huilu/pipeline/jobs', () => ({
  IdbJobStore: class {
    list = async () => {
      if (h.jobsReadFailures > 0) {
        h.jobsReadFailures--
        throw new Error('IndexedDB unavailable')
      }
      return h.jobs
    }
    get = async (id: string) => h.jobs.find((j) => j.meetingId === id)
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

const call = <T>(
  type: string,
  data?: unknown,
  sender: { tab?: { windowId?: number; id?: number } } = {},
) => Promise.resolve(h.handlers.get(type)!({ data, sender })) as Promise<T>

const start = (videoSource: 'tab' | 'screen') =>
  call<RecorderStatus>('startRecording', {
    tabId: 1,
    title: '评审',
    settings: settings(videoSource),
  })

/** 等后台里 void 掉的异步回调（onRemoved 等）跑完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  vi.restoreAllMocks()
  fakeBrowser.reset()
  h.handlers.clear()
  Object.assign(h, {
    offscreenOpen: false,
    offscreenState: 'idle',
    offscreenStart: () => Promise.resolve({ state: 'recording' }),
    closeCalls: 0,
    captureRequests: [],
    releasedClaims: [],
    openResult: async () => {},
    windowState: 'idle',
    windowStartReceivers: [],
    processingBusy: false,
    processRequests: [],
    folderAuthorizedCalls: 0,
    resultNotificationClaims: [],
    openedAppRoutes: [],
    jobs: [],
    jobsReadFailures: 0,
    sessionRules: [],
    injectFails: false,
    pageUrl: 'https://meet.example.com/abc',
    pageScript: false,
    pageState: 'idle',
    pageStarts: [],
    pageReleases: 0,
    onPrepare: async () => {},
  })
  h.recorderWindows.clear()
  // Chrome 的 windows.get 对不存在的窗口会报错（fakeBrowser 返回 undefined）
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation(async (id: number) => {
    const win = (await fakeBrowser.windows.getAll()).find((w) => w.id === id)
    if (!win) throw new Error(`No window with id: ${id}`)
    return win
  })
  // 新开的录制窗口加载完成后报告就绪；关闭后它的消息处理随之消失
  // Chrome loads recorder.html in a new tab; only that tab registers window:* handlers.
  fakeBrowser.tabs.onCreated.addListener((tab) => {
    if (!tab.url?.endsWith('/recorder.html')) return
    h.recorderWindows.add(tab.id!)
    void call('recorderWindowReady')
  })
  fakeBrowser.tabs.onRemoved.addListener((id) => void h.recorderWindows.delete(id))
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation(async (id) => {
    if (id === 1) return { id, windowId: 700, url: h.pageUrl } as never
    const tab = (await fakeBrowser.tabs.query({})).find((t) => t.id === id)
    if (!tab) throw new Error(`No tab with id: ${id}`)
    return tab
  })
  // fake-browser 2.0.1 tabs.remove incorrectly looks up a window by tab ID.
  vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation(async (ids) => {
    for (const id of Array.isArray(ids) ? ids : [ids])
      await fakeBrowser.tabs.onRemoved.trigger(id, { windowId: 700, isWindowClosing: false })
  })
  // fakeBrowser 没有实现的 API
  Object.assign(fakeBrowser, {
    scripting: {
      executeScript: async () => {
        if (h.injectFails) throw new Error('Cannot access a chrome:// URL')
        h.pageScript = true
        return []
      },
    },
    commands: { onCommand: { addListener: () => {} } },
    declarativeNetRequest: {
      getSessionRules: async () => h.sessionRules,
      updateSessionRules: async (u: {
        removeRuleIds: number[]
        addRules: typeof h.sessionRules
      }) => {
        h.sessionRules = [
          ...h.sessionRules.filter((r) => !u.removeRuleIds.includes(r.id)),
          ...u.addRules,
        ]
      },
    },
  })
  background.main()
})

describe('background recording lifecycle', () => {
  it('opens the capture tab in the initiating browser without creating or resizing windows', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    const createWindow = vi.spyOn(fakeBrowser.windows, 'create')
    const resize = vi.spyOn(fakeBrowser.windows, 'update')
    await start('screen')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 700, active: true }))
    expect(createWindow).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
  })

  it('wakes the queue recovery when startup job discovery fails', async () => {
    await settle()
    h.jobsReadFailures = 1
    h.processRequests = []
    await fakeBrowser.runtime.onStartup.trigger()
    await settle()
    expect(h.processRequests).toContainEqual({})
  })

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
    vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation(async (id: number) => {
      const tab = (await fakeBrowser.tabs.query({})).find((t) => t.id === id && id !== windowId)
      if (!tab) throw new Error(`No tab with id: ${id}`)
      return tab
    })
    const polled = await call<RecorderStatus>('getRecorderStatus')
    expect(polled.state).toBe('idle')

    await fakeBrowser.tabs.remove(windowId!)
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
      { tab: { id: first } },
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
  it.each(['missing', 'running', 'done'])(
    'checks the stored %s job before claiming and opening its result',
    async (state) => {
      await settle()
      h.jobs = state === 'missing' ? [] : [{ meetingId: 'r1', state }]
      await call('processingCompleted', 'r1')
      expect(h.resultNotificationClaims).toEqual(state === 'done' ? ['r1'] : [])
      expect(h.openedAppRoutes).toEqual(state === 'done' ? ['/meeting/r1'] : [])
    },
  )

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
    await call('recordingFinished', finished('r2'), { tab: { id: windowId } })
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

describe('GLM Coding Plan header rule (experimental)', () => {
  const planConfig = {
    preset: 'glmCodingPlan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    apiKey: 'plan-key',
    model: 'glm-x',
  }

  it('follows the saved LLM settings: on, switched off, back to the standard API', async () => {
    const { llmSetting } = await import('@/lib/settings')
    await settle()
    expect(h.sessionRules).toEqual([])

    await llmSetting.setValue({
      providerId: 'openai-compatible',
      configs: { 'openai-compatible': planConfig },
    })
    await settle()
    expect(h.sessionRules.map((r) => r.condition.urlFilter)).toEqual([
      '|https://open.bigmodel.cn/api/coding/paas/v4/',
    ])

    await llmSetting.setValue({
      providerId: 'openai-compatible',
      configs: { 'openai-compatible': { ...planConfig, clientHeaders: 'off' } },
    })
    await settle()
    expect(h.sessionRules).toEqual([])

    await llmSetting.setValue({
      providerId: 'openai-compatible',
      configs: {
        'openai-compatible': {
          ...planConfig,
          preset: 'zhipu',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        },
      },
    })
    await settle()
    expect(h.sessionRules).toEqual([])
  })

  it('re-creates the rule on worker start and before each processing step', async () => {
    const { llmSetting } = await import('@/lib/settings')
    await llmSetting.setValue({
      providerId: 'openai-compatible',
      configs: { 'openai-compatible': planConfig },
    })
    await settle()
    // 浏览器重启：会话规则被清空，后台启动时按已保存的设置恢复
    h.sessionRules = []
    background.main()
    await settle()
    expect(h.sessionRules).toHaveLength(1)
    // 处理步骤取设置前也会同步
    h.sessionRules = []
    await call('processingSettings')
    expect(h.sessionRules).toHaveLength(1)
  })
})

describe('U-41–U-44 regression', () => {
  it.each([undefined, true, false])(
    'propagates source-audio preference %s, with old preferences enabled',
    async (sourceAudio) => {
      const snapshot = settings('tab')
      snapshot.prefs.sourceAudio = sourceAudio
      await call('startRecording', { tabId: 1, title: 'test', settings: snapshot })
      expect(h.captureRequests[0]).toMatchObject({
        sourceAudio: sourceAudio !== false,
        sourceAudioRequested: sourceAudio !== false,
      })
    },
  )

  it('acknowledges idle before closing the sender', async () => {
    await settle()
    h.offscreenOpen = true
    await call('processingIdle')
    expect(h.offscreenOpen).toBe(true)
    await settle()
    expect(h.offscreenOpen).toBe(false)
  })

  it('keeps the sender alive during result delivery even when idle arrives concurrently', async () => {
    await settle()
    h.offscreenOpen = true
    h.jobs = [{ meetingId: 'r1', state: 'done' }]
    let release!: () => void
    h.openResult = () =>
      new Promise<void>((r) => {
        release = r
      })
    const notification = call('processingCompleted', 'r1')
    await settle()
    await call('processingIdle')
    await settle()
    expect(h.offscreenOpen).toBe(true)
    const duplicate = call('processingCompleted', 'r1')
    release()
    await Promise.all([notification, duplicate])
    expect(h.openedAppRoutes).toEqual(['/meeting/r1'])
    expect(h.offscreenOpen).toBe(true)
    await settle()
    expect(h.offscreenOpen).toBe(false)
  })

  it('releases the durable claim when opening a result fails, and exposes the error', async () => {
    await settle()
    h.jobs = [{ meetingId: 'r1', state: 'done' }]
    h.openResult = async () => {
      throw new Error('tabs unavailable')
    }
    await expect(call('processingCompleted', 'r1')).rejects.toThrow('tabs unavailable')
    expect(h.releasedClaims).toEqual(['r1'])
    h.openResult = async () => {}
    await call('processingCompleted', 'r1')
    expect(h.openedAppRoutes).toEqual(['/meeting/r1'])
    await settle()
  })
})

it('routes the unified picker through a visible host even when the previous preference was tab', async () => {
  const snapshot = settings('tab')
  snapshot.prefs.sourceSelection = 'choose'
  const result = await call<RecorderStatus>('startRecording', {
    tabId: 1,
    title: 'Unified source',
    settings: snapshot,
  })
  // 网页里等用户点「选择来源」
  expect(result).toMatchObject({ state: 'starting', awaitingSource: true })
  expect(h.captureRequests).toEqual([])
  // 可见宿主优先是发起录制的网页本身，不再开采集标签页
  expect(h.pageStarts).toHaveLength(1)
  expect(h.windowStartReceivers).toEqual([])
})

it('keeps quick current-tab capture explicit even when the last legacy preference was screen', async () => {
  const snapshot = settings('screen')
  snapshot.prefs.sourceSelection = 'current-tab'
  await call<RecorderStatus>('startRecording', { tabId: 1, title: 'Quick tab', settings: snapshot })
  expect(h.windowStartReceivers).toEqual([])
  expect(h.captureRequests).toMatchObject([{ source: 'tab' }])
})

describe('U-93 capture tab lifecycle', () => {
  it('restores the source tab while retaining the live capture document', async () => {
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove')
    await start('screen')
    expect(update).toHaveBeenCalledWith(1, { active: true })
    expect(remove).not.toHaveBeenCalled()
    expect(await call('getRecorderStatus')).toMatchObject({ state: 'recording' })
  })

  it('retains start failures in the toolbar without injecting an idle webpage panel', async () => {
    h.offscreenStart = () => Promise.reject(new Error('CaptureCancelledError: cancelled'))
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript')
    await expect(start('tab')).rejects.toThrow('cancelled')
    expect(inject).not.toHaveBeenCalled()
    expect(await call('getRecorderStatus')).toMatchObject({
      state: 'idle',
      startError: expect.stringContaining('CaptureCancelledError'),
    })
  })
})

describe('in-page recording', () => {
  const choose = () =>
    call<RecorderStatus>('startRecording', {
      tabId: 1,
      title: '评审',
      settings: {
        mode: 'audio',
        prefs: { ...settings('tab').prefs, sourceSelection: 'choose', sourceAudio: true },
      },
    })

  /** 网页报告：用户在录制面板上选好来源，录制已开始 */
  const pageStarted = async () => {
    h.pageState = 'recording'
    await call('pageRecordingStarted', { state: 'recording' }, { tab: { id: 1 } })
  }

  it('arms the initiating page and waits for the user to choose in-page, without a capture tab', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    expect(await choose()).toMatchObject({
      state: 'starting',
      awaitingSource: true,
      panelShown: true,
    })
    expect(create).not.toHaveBeenCalled()
    expect(h.pageStarts).toMatchObject([{ chooseSource: true, sourceAudio: true }])
    // 等待选源时也算忙，不能再开始一次
    await expect(choose()).rejects.toThrow('already in progress')

    await pageStarted()
    expect(await call('getRecorderStatus')).toMatchObject({ state: 'recording' })
    expect(await fakeBrowser.action.getBadgeText({})).toBe('REC')
  })

  it('falls back to a capture tab on insecure http pages, which the picker rejects', async () => {
    h.pageUrl = 'http://intranet.example.com/'
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await choose()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 700 }))
    expect(h.pageStarts).toEqual([])
  })

  it('falls back to a capture tab when the page cannot be injected', async () => {
    h.injectFails = true
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await choose()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 700 }))
    expect(h.pageStarts).toEqual([])
  })

  it('keeps the reason when the user cancels or the picker fails in the page', async () => {
    await choose()
    h.pageState = 'idle'
    await call('pageRecordingFailed', 'CaptureCancelledError: cancelled', { tab: { id: 1 } })
    expect(await call('getRecorderStatus')).toMatchObject({
      state: 'idle',
      startError: expect.stringContaining('CaptureCancelledError'),
    })
    // 失败后可以重新开始
    expect(await choose()).toMatchObject({ awaitingSource: true })
  })

  it('ignores page reports from other tabs', async () => {
    await choose()
    await call('pageRecordingFailed', 'CaptureCancelledError: cancelled', { tab: { id: 9 } })
    expect(await call('getRecorderStatus')).toMatchObject({ state: 'starting' })
  })

  it('forgets an armed page that is closed before a source is chosen', async () => {
    await choose()
    await fakeBrowser.tabs.remove(1)
    await settle()
    h.pageScript = false
    const status = await call<RecorderStatus>('getRecorderStatus')
    expect(status).toMatchObject({ state: 'idle' })
    expect(status.lastResult).toBeUndefined()
  })

  it('marks the recording interrupted once the page reloads and its script is gone', async () => {
    await choose()
    await pageStarted()
    h.pageScript = false
    const status = await call<RecorderStatus>('getRecorderStatus')
    expect(status).toMatchObject({
      state: 'idle',
      lastResult: { error: 'RecorderPageClosed', saved: false },
    })
    expect(await fakeBrowser.action.getBadgeText({})).toBe('')
  })

  it('keeps the user page open when the in-page recording finishes', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove')
    await choose()
    await pageStarted()
    h.pageState = 'idle'
    await call('recordingFinished', { id: 'r1', saved: false }, { tab: { id: 1 } })
    await settle()
    expect(remove).not.toHaveBeenCalled()
    expect(await call('getRecorderStatus')).toMatchObject({ state: 'idle' })
  })

  it('accepts the storage frame token once, only from the recorded tab', async () => {
    const verify = (token: unknown, tabId: number) =>
      Promise.resolve(
        h.handlers.get('verifyRecorderSink')!({ data: token, sender: { tab: { id: tabId } } }),
      )
    const results: unknown[] = []
    // 存储 iframe 在 page:prepare 期间向后台校验令牌
    h.onPrepare = async (token) => {
      results.push(await verify('guess', 1), await verify(token, 2), await verify(token, 1))
      results.push(await verify(token, 1))
    }
    await choose()
    expect(results).toEqual([false, false, true, false])
  })
})
