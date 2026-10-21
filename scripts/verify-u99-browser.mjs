// U-99 evidence: toolbar icon → in-page panel → start, in a real Chromium with the built extension.
// The icon is clicked with a real X11 mouse click (CDP Extensions.triggerAction does not grant activeTab).
// Needs DISPLAY (e.g. a private Xorg / Xvfb at 1024x768), xfwm4 and xdotool.
// The share picker is auto-selected by tab title, so this does not cover the native picker UI.
/* global chrome */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'output/playwright', `U-99-${Date.now()}`)
const ext = resolve(root, 'apps/extension/.output/chrome-mv3')
await mkdir(out, { recursive: true })
const en = JSON.parse(await readFile(resolve(root, 'packages/i18n/src/locales/en.json'), 'utf8'))
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright-core'
)

const TITLE = 'U99 meeting'
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(`<!doctype html><title>${TITLE}</title><h1>Meeting source</h1>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const pageUrl = `http://127.0.0.1:${server.address().port}/`
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { cases: [], limitations: [] }
const check = (name, passed, detail) => report.cases.push({ name, passed, ...detail })

// 固定插件 ID（manifest key），预先把图标固定到工具栏上
const EXTENSION_ID = 'fddknloecifbbeomieckhnegffdobgni'
const profile = resolve(out, 'profile')
await mkdir(resolve(profile, 'Default'), { recursive: true })
await writeFile(
  resolve(profile, 'Default/Preferences'),
  JSON.stringify({ extensions: { pinned_extensions: [EXTENSION_ID] } }),
)
const wm = spawn(process.env.WM_PATH || 'xfwm4', ['--compositor=off'], { stdio: 'ignore' })
await pause(800)
// 1024x768 屏幕、窗口铺满时插件图标的位置（星标右侧、拼图左侧）
const ICON = [Number(process.env.ICON_X || 870), Number(process.env.ICON_Y || 63)]

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  viewport: null,
  locale: 'en-US',
  args: [
    '--no-sandbox',
    '--window-position=0,0',
    '--window-size=1024,768',
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    `--auto-select-tab-capture-source-by-title=${TITLE}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
})
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(sw.url()).host
  const logs = []
  report.logs = logs
  sw.on('console', (m) => logs.push(`sw ${m.type()}: ${m.text()}`))
  assert.equal(extensionId, EXTENSION_ID)
  const clickIcon = async (target) => {
    await target.bringToFront()
    await pause(300)
    execFileSync('xdotool', ['mousemove', ...ICON.map(String), 'click', '1'])
    await pause(1500)
  }
  const screen = (name) =>
    execFileSync('bash', [
      '-c',
      `xwd -root | ffmpeg -loglevel error -y -f xwd_pipe -i - '${resolve(out, name)}'`,
    ])
  const session = () => sw.evaluate(() => chrome.storage.session.get(null))
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}))

  const page = context.pages()[0] ?? (await context.newPage())
  // 首次安装会打开引导页：等它出现后关掉，否则它可能在点图标前抢成激活标签页
  const onboarding =
    context.pages().find((p) => p.url().includes('onboarding')) ??
    (await context.waitForEvent('page', { timeout: 5000 }).catch(() => undefined))
  await onboarding?.close()
  await page.goto(pageUrl)
  page.on('console', (m) => logs.push(`page ${m.type()}: ${m.text()}`))
  const pageCdp = await context.newCDPSession(page)
  const activeTabId = () =>
    sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id)

  /** 面板在封闭 Shadow DOM 里：用 CDP 穿透查找含指定文字的按钮，再用真实鼠标点击 */
  const findButton = async (text) => {
    const { root: doc } = await pageCdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : (n.children ?? []).map(textOf).join(''))
    const walk = (n) => {
      const kids = [...(n.children ?? []), ...(n.shadowRoots ?? [])]
      if (n.nodeName === 'BUTTON' && textOf(n).trim() === text) return n
      for (const k of kids) {
        const hit = walk(k)
        if (hit) return hit
      }
    }
    return walk(doc)
  }
  const clickButton = async (text) => {
    const node = await findButton(text)
    assert(node, `button "${text}" not found`)
    const { model } = await pageCdp.send('DOM.getBoxModel', { nodeId: node.nodeId })
    const [x1, y1, , , x3, y3] = model.border
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2)
  }
  const waitFor = async (fn, ms = 10_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const v = await fn()
      if (v) return v
      await pause(250)
    }
    return fn()
  }

  // 1. 点图标：当前网页上出现设置面板，不打开工具栏弹窗
  await clickIcon(page)
  const tabId = await activeTabId()
  const setupShown = Boolean(await findButton(en.popup.chooseAndStart))
  const popup = await sw.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId)
  await page.screenshot({ path: resolve(out, '1-setup-panel.png') })
  check('icon click shows setup panel in page', setupShown && !popup.includes('fallback'), {
    setupShown,
    popup,
  })

  // 2. 面板上「选择来源并开始」：一次点击直接进入选择框（这里按标题自动选中），录制开始
  await clickButton(en.popup.chooseAndStart)
  const started = await waitFor(async () => (await session()).recorderTab?.started === true)
  const host = (await session()).recorderTab
  await page.screenshot({ path: resolve(out, '2-recording-from-picker.png') })
  check('choose source & start records in page with one panel click', started, {
    host,
    badge: await badge(),
    sourcePromptShown: Boolean(await findButton(en.panel.chooseSource)),
  })

  // 3. 结束：面板回到设置视图并显示「已保存」
  await clickButton(en.sidepanel.stop)
  await clickButton(en.sidepanel.confirmStopAction)
  const finished = await waitFor(async () => (await session()).lastRecording)
  await pause(800)
  const backToSetup = Boolean(await findButton(en.popup.recordCurrentTab))
  await page.screenshot({ path: resolve(out, '3-finished-back-to-setup.png') })
  check('stop returns the panel to setup with the result', backToSetup && finished?.saved, {
    lastRecording: finished,
  })

  // 4. 「录制当前标签页」（tabCapture，依赖点图标授予的 activeTab）
  await clickButton(en.popup.recordCurrentTab)
  const tabRec = await waitFor(async () => (await badge()) === 'REC')
  await page.screenshot({ path: resolve(out, '4-current-tab.png') })
  const tabSession = await session()
  const startError = tabSession.lastStartError ?? null
  check('record this tab from the panel', tabRec, {
    badge: await badge(),
    startError,
    // 没有 activeTab 时 getMediaStreamId 报 “Extension has not been invoked”；走到取流才失败说明授权有效
    activeTabGranted: tabRec || !/not been invoked|cannot be captured/i.test(String(startError)),
    // 本机既有限制（U-64 / U-91 / U-95 文档）：tabCapture → offscreen 取流报 NotFoundError
    knownEnvironmentLimitation: /Requested device not found/.test(String(startError)),
  })
  if (tabRec) {
    await clickButton(en.sidepanel.stop)
    await clickButton(en.sidepanel.confirmStopAction)
    await waitFor(async () => (await badge()) === '')
  }

  // 5. 录制中点图标：显示录制面板
  await clickButton(en.popup.chooseAndStart)
  await waitFor(async () => (await session()).recorderTab?.started === true)
  await clickIcon(page)
  const recordingPanel = Boolean(await findButton(en.sidepanel.stop))
  await page.screenshot({ path: resolve(out, '5-click-while-recording.png') })
  check('icon click while recording shows the recording panel', recordingPanel, {})
  await clickButton(en.sidepanel.stop)
  await clickButton(en.sidepanel.confirmStopAction)
  await waitFor(async () => (await badge()) === '')

  // 6. 不能注入的页面：退回工具栏弹窗
  const blocked = await context.newPage()
  await blocked.goto('chrome://version/')
  await clickIcon(blocked)
  const blockedTab = await activeTabId()
  const fallback = await sw.evaluate((id) => chrome.action.getPopup({ tabId: id }), blockedTab)
  const popups = await sw.evaluate(
    async () => (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length,
  )
  screen('6-fallback-popup.png')
  // 关掉弹窗：端口断开后恢复为点击打开网页面板
  execFileSync('xdotool', ['key', 'Escape'])
  await pause(1000)
  const afterClose = await sw.evaluate((id) => chrome.action.getPopup({ tabId: id }), blockedTab)
  check(
    'non-injectable page opens the fallback popup, reset after it closes',
    fallback.includes('fallback') && popups === 1 && !afterClose.includes('fallback'),
    { popupSetForTab: fallback, openPopups: popups, popupAfterClose: afterClose },
  )
  report.limitations.push(
    'Chromium 156 on a Linux X11 virtual display; the share picker was auto-selected by tab title, the native picker UI was not clicked',
    'Fake media devices; no real microphone, macOS/Windows or real ASR',
  )
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log('artifacts:', out)
  await context.close()
  server.close()
  wm.kill()
}
