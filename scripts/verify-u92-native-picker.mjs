// Native chooser evidence, no picker/device injection. All child processes exit in finally.
/* global chrome */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const label = process.env.BASELINE_EXTENSION ? 'before' : 'after'
const out = resolve(root, 'output/playwright', `U-92-${label}-${Date.now()}`)
const ext = resolve(out, 'extension')
await mkdir(out, { recursive: true })
await cp(
  process.env.BASELINE_EXTENSION || resolve(root, 'apps/extension/.output/chrome-mv3'),
  ext,
  {
    recursive: true,
  },
)
await writeFile(resolve(ext, 'u92-harness.html'), '<!doctype html><title>U-92 verification</title>')
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright-core'
)
const xvfb = spawn(
  process.env.XVFB_PATH || 'Xvfb',
  [
    '-displayfd',
    '3',
    '-screen',
    '0',
    process.env.SCREEN_SIZE || '1600x1000x24',
    '-nolisten',
    'tcp',
  ],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
)
let context, wm
let xvfbError = ''
xvfb.stderr.on('data', (data) => {
  xvfbError += data
})
const report = {
  label,
  injected: false,
  cases: [],
  limitations: 'Linux X11 virtual display; not macOS/Windows or physical multi-monitor/microphone',
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  const displayNumber = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb timeout: ' + xvfbError)), 10000)
    xvfb.stdio[3].once('data', (data) => {
      clearTimeout(timer)
      resolve(String(data).trim())
    })
    xvfb.once('error', reject)
    xvfb.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Xvfb exit ${code}: ${xvfbError}`))
    })
  })
  const display = `:${displayNumber}`
  const env = { ...process.env, DISPLAY: display }
  wm = spawn(process.env.WM_PATH || 'xfwm4', ['--compositor=off'], { env, stdio: 'ignore' })
  // Give the local window manager time to claim its X selection before Chrome starts.
  await pause(600)
  context = await chromium.launchPersistentContext(resolve(out, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH,
    env,
    headless: false,
    viewport: null,
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      `--force-device-scale-factor=${process.env.SCALE || '1'}`,
    ],
  })
  context.setDefaultTimeout(12000)
  report.browser = context.browser().version()
  const control = context.pages()[0]
  await control.goto('chrome-extension://fddknloecifbbeomieckhnegffdobgni/u92-harness.html')
  await control.evaluate(() => chrome.storage.local.set({ onboarded: true, locale: 'en' }))
  report.screen = await control.evaluate(() => ({
    left: screen.availLeft,
    top: screen.availTop,
    width: screen.availWidth,
    height: screen.availHeight,
    devicePixelRatio,
  }))
  const parent = await control.evaluate(async (small) => {
    const win = await chrome.windows.getCurrent()
    return chrome.windows.update(win.id, {
      left: 100,
      top: 50,
      width: small ? 420 : Math.min(1400, screen.availWidth - 200),
      height: small ? 340 : Math.min(900, screen.availHeight - 100),
    })
  }, process.env.SMALL_PARENT === '1')
  report.parent = parent
  const tabId = await control.evaluate(async () => (await chrome.tabs.getCurrent()).id)
  const send = (type, data) =>
    control.evaluate(
      ({ type, data }) =>
        new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { id: Date.now(), type, data, timestamp: Date.now() },
            (result) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
              else resolve(result)
            },
          )
        }),
      { type, data },
    )
  const screenshot = async (name) => {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'x11grab',
        '-i',
        display,
        '-frames:v',
        '1',
        resolve(out, name + '.png'),
      ],
      { env, timeout: 15000 },
    )
    await writeFile(
      resolve(out, name + '-xwindows.txt'),
      execFileSync('xwininfo', ['-root', '-tree'], { env }),
    )
  }
  const cases = [
    ['window', 'cancel'],
    ['screen', 'close'],
  ]
  if (process.env.NATIVE_SHARE === '1') cases.push(['screen', 'share'])
  for (const [source, action] of cases) {
    const pending = send('startRecording', {
      tabId,
      title: `U-92 native ${source}`,
      settings: {
        mode: 'video',
        prefs: {
          videoSource: source,
          sourceAudio: false,
          microphone: false,
          quality: { resolution: '720p', fps: 15 },
          language: 'en',
        },
      },
    })
    // Prevent unhandled rejection if the user/WM closes the dialog before we collect evidence.
    pending.catch(() => {})
    const recorder = await context.waitForEvent('page', { predicate: (p) => p !== control })
    await recorder.waitForURL('**/recorder.html')
    await recorder.getByRole('heading', { name: 'HuiLu' }).waitFor()
    await pause(1200) // local native UI paint, not an external-job wait
    const bounds = await recorder.evaluate(async () => chrome.windows.getCurrent())
    await screenshot(`${source}-${action}`)
    const busy = await send('startRecording', { tabId, title: 'Duplicate start' })
    assert.match(JSON.stringify(busy), /RecorderBusyError/)
    if (action === 'share') {
      // X11 coordinates for this Chromium screen chooser. This is a real native click,
      // not an auto-select flag or substituted desktopCapture callback.
      const scale = report.screen.devicePixelRatio
      const click = (x, y) =>
        execFileSync(
          'xdotool',
          ['mousemove', String(Math.round(x * scale)), String(Math.round(y * scale)), 'click', '1'],
          { env },
        )
      click(bounds.left + bounds.width / 2 - 135, bounds.top + 190)
      await pause(200)
      await screenshot('screen-selected')
      click(bounds.left + bounds.width / 2 + 245, bounds.top + 381)
      const result = await Promise.race([
        pending,
        pause(12000).then(() => {
          throw new Error('Native Share click did not start recording')
        }),
      ])
      assert.equal(result.res?.state, 'recording', JSON.stringify(result))
      await pause(2200)
      assert.equal((await send('pauseRecording')).res.state, 'paused')
      assert.equal((await send('resumeRecording')).res.state, 'recording')
      await send('stopRecording')
      // recordingFinished retires the host asynchronously; wait for its real close.
      if (!recorder.isClosed()) await recorder.waitForEvent('close')
      const status = await send('getRecorderStatus')
      assert.equal(status.res.state, 'idle')
      assert.equal(status.res.lastResult.saved, true)
      assert.ok(status.res.lastResult.bytes > 0)
      report.cases.push({ source, action, bounds, result, status })
      continue
    }
    if (action === 'cancel') execFileSync('xdotool', ['key', '--clearmodifiers', 'Escape'], { env })
    else await control.evaluate((id) => chrome.windows.remove(id), bounds.id)
    const result = await pending
    assert.ok(result.err, JSON.stringify(result))
    if (!recorder.isClosed()) await recorder.waitForEvent('close')
    const status = await send('getRecorderStatus')
    assert.equal(status.res.state, 'idle')
    const remaining = await control.evaluate(
      async () =>
        (await chrome.tabs.query({})).filter((t) => t.url?.endsWith('/recorder.html')).length,
    )
    assert.equal(remaining, 0)
    report.cases.push({ source, action, bounds, busy, result, status, remaining })
    if (label === 'after') {
      assert.equal(bounds.width, Math.min(960, report.screen.width - 64))
      assert.equal(bounds.height, Math.min(720, report.screen.height - 64))
      assert.ok(bounds.left >= report.screen.left)
      assert.ok(bounds.top >= report.screen.top)
      assert.ok(bounds.left + bounds.width <= report.screen.left + report.screen.width)
      assert.ok(bounds.top + bounds.height <= report.screen.top + report.screen.height)
    }
  }
  report.passed = true
} catch (error) {
  report.error = String(error.stack || error)
  process.exitCode = 1
} finally {
  if (context) await context.close()
  for (const child of [wm, xvfb]) {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((r) => child.once('exit', r))
      child.kill('SIGTERM')
      await exited
    }
  }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
