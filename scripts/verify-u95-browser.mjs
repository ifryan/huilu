// Built extension evidence. Native mode uses X11 clicks, never an automatic sharing flag.
/* global chrome */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(import.meta.dirname, '..')
const injected = process.env.INJECT_CAPTURE === '1'
const baseline = process.env.BASELINE_EXTENSION
const out = resolve(
  root,
  'output/playwright',
  `U-95-${baseline ? 'baseline' : injected ? 'injected' : 'native'}-${Date.now()}`,
)
const ext = resolve(out, 'extension')
await mkdir(out, { recursive: true })
await cp(baseline || resolve(root, 'apps/extension/.output/chrome-mv3'), ext, { recursive: true })
await writeFile(resolve(ext, 'u95-harness.html'), '<!doctype html><title>U95 control</title>')
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
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(
    `<!doctype html><title>U95 sample meeting</title><h1>Meeting source</h1><button onclick="window.ctx=new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=440;g.gain.value=.2;o.connect(g).connect(ctx.destination);o.start()">Play 440 Hz</button>`,
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
let context, wm
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const report = {
  injected,
  baseline: Boolean(baseline),
  ui: [],
  cases: [],
  limitations:
    'Linux X11 virtual display; no physical microphone/multi-monitor, Windows/macOS or real ASR',
}
try {
  const display =
    ':' +
    (await new Promise((r, j) => {
      xvfb.stdio[3].once('data', (d) => r(String(d).trim()))
      xvfb.once('error', j)
      xvfb.once('exit', (code) => j(new Error('Xvfb exit ' + code)))
    }))
  const env = { ...process.env, DISPLAY: display }
  wm = spawn(process.env.WM_PATH || 'xfwm4', ['--compositor=off'], { env, stdio: 'ignore' })
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
      `--force-device-scale-factor=${process.env.SCALE || 1}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  context.setDefaultTimeout(12000)
  if (injected)
    await context.addInitScript(() => {
      if (location.pathname !== '/recorder.html') return
      const log = (event) => chrome.runtime.sendMessage({ u95Event: event })
      const config = new URLSearchParams(location.search)
      void config
      chrome.desktopCapture.chooseDesktopMedia = (sources, callback) => {
        void chrome.storage.local
          .get('u95Case')
          .then(({ u95Case: c }) =>
            log({ type: 'picker', sources }).then(() =>
              callback('injected-desktop', { canRequestAudioTrack: c.granted }),
            ),
          )
        return 95
      }
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const { u95Case: c } = await chrome.storage.local.get('u95Case')
        await log({ type: 'media', constraints })
        const streams = []
        if (constraints.video) {
          const canvas = document.createElement('canvas')
          canvas.width = 640
          canvas.height = 360
          const paint = () => {
            const g = canvas.getContext('2d')
            g.fillStyle = '#c4e6ff'
            g.fillRect(0, 0, 640, 360)
            g.fillStyle = '#111'
            g.fillText('Injected meeting ' + Date.now(), 20, 50)
            requestAnimationFrame(paint)
          }
          paint()
          const stream = canvas.captureStream(15),
            track = stream.getVideoTracks()[0],
            original = track.getSettings.bind(track)
          track.getSettings = () => ({ ...original(), displaySurface: c.surface })
          streams.push(stream)
        }
        if ((!constraints.video || constraints.audio) && !c.missingTrack) {
          const ctx = new AudioContext(),
            osc = ctx.createOscillator(),
            gain = ctx.createGain(),
            dest = ctx.createMediaStreamDestination()
          osc.frequency.value = constraints.video ? 440 : 880
          gain.gain.value = 0.2
          osc.connect(gain).connect(dest)
          osc.start()
          streams.push(dest.stream)
          const track = dest.stream.getAudioTracks()[0],
            stop = track.stop.bind(track)
          track.stop = () => {
            stop()
            void ctx.close()
          }
        }
        const stream = new MediaStream(streams.flatMap((s) => s.getTracks()))
        stream.getTracks().forEach((track) => {
          const stop = track.stop.bind(track)
          track.stop = () => {
            void log({ type: 'stop', kind: track.kind })
            stop()
          }
        })
        return stream
      }
    })
  const base = 'chrome-extension://fddknloecifbbeomieckhnegffdobgni'
  const control = context.pages()[0]
  await control.goto(base + '/u95-harness.html')
  await control.evaluate(() => {
    window.events = []
    chrome.runtime.onMessage.addListener((m) => {
      if (m.u95Event) window.events.push(m.u95Event)
    })
  })
  // Discard only the onboarding tab created in this isolated test profile.
  for (const page of context.pages()) if (page !== control) await page.close()
  const source = await context.newPage()
  await source.goto(`http://127.0.0.1:${server.address().port}`)
  await source.getByRole('button').click()
  const tabId = await control.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    source.url(),
  )
  const send = (type, data) =>
    control.evaluate(
      ({ type, data }) =>
        new Promise((r, j) =>
          chrome.runtime.sendMessage(
            { id: Date.now(), type, data, timestamp: Date.now() },
            (result) =>
              chrome.runtime.lastError ? j(new Error(chrome.runtime.lastError.message)) : r(result),
          ),
        ),
      { type, data },
    )
  const status = async () => (await send('getRecorderStatus')).res
  const prefs = {
    videoSource: 'window',
    sourceSelection: 'choose',
    sourceAudio: true,
    microphone: false,
    quality: { resolution: '720p', fps: 15 },
    language: 'zh',
  }
  const popup = await context.newPage()
  report.browser = context.browser().version()
  report.screen = await control.evaluate(() => ({
    width: screen.availWidth,
    height: screen.availHeight,
    scale: devicePixelRatio,
  }))
  const shot = async (name) => {
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
  }
  const metrics = () =>
    popup.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      body: document.querySelector('main').getBoundingClientRect().toJSON(),
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollY,
      button: [...document.querySelectorAll('button')].at(-1)?.getBoundingClientRect().toJSON(),
    }))
  for (const locale of ['zh-CN', 'en'])
    for (const mode of ['audio', 'video']) {
      await control.evaluate(
        async ({ prefs, locale, mode }) =>
          chrome.storage.local.set({
            onboarded: true,
            locale,
            recordingMode: mode,
            recordingPrefs: prefs,
          }),
        { prefs, locale, mode },
      )
      await popup.setViewportSize({ width: 320, height: 600 })
      await popup.goto(base + '/popup.html')
      await popup
        .getByRole('button', {
          name: locale === 'en' ? 'Audio + video' : '音频 + 视频',
          exact: true,
        })
        .waitFor()
      await pause(200)
      const before = await metrics()
      await popup.screenshot({ path: resolve(out, `popup-${locale}-${mode}.png`), fullPage: true })
      if (!baseline) {
        assert.ok(before.body.height <= 600, JSON.stringify(before))
        assert.equal(before.scrollWidth, 320)
        const details = popup
          .locator('details')
          .filter({ hasText: locale === 'en' ? 'More settings' : '更多设置' })
          .first()
        await details.locator('summary').focus()
        await popup.keyboard.press('Enter')
        assert.ok((await details.getAttribute('open')) !== null)
        await popup.screenshot({
          path: resolve(out, `expanded-${locale}-${mode}.png`),
          fullPage: true,
        })
        const expanded = await metrics()
        assert.ok(expanded.body.height > before.body.height)
        await details.locator('summary').click()
        report.ui.push({ locale, mode, default: before, expanded })
      } else report.ui.push({ locale, mode, default: before })
    }
  if (!baseline) {
    await popup.setViewportSize({ width: 320, height: 480 })
    await popup.reload()
    await pause(300)
    const small = await metrics()
    await popup.screenshot({ path: resolve(out, 'popup-small.png'), fullPage: true })
    report.ui.push({ small })
    assert.ok(small.button.bottom <= 480, JSON.stringify(small))
    // Default microphone-on state and discoverable settings remain reachable.
    await control.evaluate(
      (prefs) => chrome.storage.local.set({ recordingPrefs: { ...prefs, microphone: true } }),
      prefs,
    )
    await popup.setViewportSize({ width: 320, height: 600 })
    await popup.reload()
    await pause(300)
    const microphoneOn = await metrics()
    await popup.screenshot({ path: resolve(out, 'popup-microphone-on.png'), fullPage: true })
    assert.ok(microphoneOn.body.height <= 600, JSON.stringify(microphoneOn))
    report.ui.push({ microphoneOn })
    const advanced = popup.locator('details').filter({ hasText: 'More settings' }).first()
    await advanced.locator('summary').click()
    await popup.getByRole('button', { name: '1080p', exact: true }).click()
    await popup.getByRole('button', { name: '30fps', exact: true }).click()
    await popup.getByLabel('Spoken language', { exact: true }).selectOption('auto')
    await popup.getByLabel('Meeting title', { exact: true }).fill('Review meeting')
    await popup
      .getByLabel('Quick capture current tab (skip source picker)', { exact: true })
      .check()
    await popup.getByRole('button', { name: 'Start recording', exact: true }).focus()
    const focused = await metrics()
    assert.ok(focused.button.bottom <= 600, JSON.stringify(focused))
    const saved = await control.evaluate(
      async () => (await chrome.storage.local.get('recordingPrefs')).recordingPrefs,
    )
    assert.equal(saved.sourceSelection, 'current-tab')
    assert.equal(saved.quality.resolution, '1080p')
    assert.equal(saved.quality.fps, 30)
    assert.equal(saved.language, 'auto')
    report.ui.push({ advancedSaved: saved, focused })
    await control.evaluate((prefs) => chrome.storage.local.set({ recordingPrefs: prefs }), prefs)
    // Use the actual Chrome action popup as well as fixed-size document layout checks.
    await popup.close()
    await source.bringToFront()
    const opened = context.waitForEvent('page', { timeout: 5000 }).catch(() => undefined)
    await control
      .evaluate(() => chrome.action.openPopup())
      .catch((e) => (report.actionPopupError = String(e)))
    const action = await opened
    await pause(500)
    await writeFile(
      resolve(out, 'action-xwindows.txt'),
      execFileSync('xwininfo', ['-root', '-tree'], { env }),
    )
    const cdp = await context.browser().newBrowserCDPSession()
    const targets = await cdp.send('Target.getTargets')
    report.popupTargets = targets.targetInfos.filter((t) => t.url.endsWith('/popup.html'))
    const target = report.popupTargets[0]
    let popupSession
    let commandId = 0
    const popupCommand = async (method, params = {}) => {
      const id = ++commandId
      const answer = new Promise((r, j) => {
        const listener = (event) => {
          if (event.sessionId !== popupSession) return
          const m = JSON.parse(event.message)
          if (m.id !== id) return
          cdp.off('Target.receivedMessageFromTarget', listener)
          if (m.error) j(new Error(JSON.stringify(m.error)))
          else r(m.result)
        }
        cdp.on('Target.receivedMessageFromTarget', listener)
      })
      await cdp.send('Target.sendMessageToTarget', {
        sessionId: popupSession,
        message: JSON.stringify({ id, method, params }),
      })
      return answer
    }
    if (target) {
      popupSession = (
        await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
      ).sessionId
      report.actualPopupDOM = (
        await popupCommand('Runtime.evaluate', {
          expression: `JSON.stringify({width:innerWidth,height:innerHeight,screenX,screenY,body:document.querySelector('main')?.getBoundingClientRect().toJSON(),scrollHeight:document.documentElement.scrollHeight,text:document.body.innerText,button:[...document.querySelectorAll('button')].at(-1)?.getBoundingClientRect().toJSON()})`,
          returnByValue: true,
        })
      ).result.value
    }
    await shot('action-popup-desktop')
    if (action) {
      await action.waitForLoadState()
      await pause(300)
      report.actionPopup = await action.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }))
      await action.screenshot({ path: resolve(out, 'actual-action-popup.png') })
      await shot('actual-action-desktop')
      // Leave the native action popup open for the real CTA click below.
    }
    const readRecording = async (id) =>
      control.evaluate(async (id) => {
        const d = await (
          await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings')
        ).getDirectoryHandle(id)
        const manifest = JSON.parse(
          await (await (await d.getFileHandle('manifest.json')).getFile()).text(),
        )
        const meeting = JSON.parse(
          await (await (await d.getFileHandle('meeting.json')).getFile()).text(),
        )
        let signal
        if (manifest.tracks.audio) {
          const dir = await d.getDirectoryHandle('audio'),
            parts = []
          for (let i = 1; i <= manifest.tracks.audio.chunks; i++)
            parts.push(
              await (await dir.getFileHandle(String(i).padStart(6, '0') + '.part')).getFile(),
            )
          const ctx = new AudioContext()
          try {
            const audio = await ctx.decodeAudioData(await new Blob(parts).arrayBuffer()),
              values = audio.getChannelData(0),
              from = Math.round(audio.sampleRate * 0.25),
              n = Math.min(audio.sampleRate, values.length - from)
            const amplitude = (frequency) => {
              let re = 0,
                im = 0
              for (let i = 0; i < n; i++) {
                const a = (2 * Math.PI * frequency * i) / audio.sampleRate
                re += values[from + i] * Math.cos(a)
                im += values[from + i] * Math.sin(a)
              }
              return (2 * Math.hypot(re, im)) / n
            }
            signal = {
              source440: amplitude(440),
              mic880: amplitude(880),
              channels: audio.numberOfChannels,
            }
          } finally {
            await ctx.close()
          }
        }
        return { manifest, meeting, signal }
      }, id)
    const launch = async (name, options = {}) => {
      const start = send('startRecording', {
        tabId,
        title: 'U95 ' + name,
        settings: { mode: options.mode || 'video', prefs: { ...prefs, ...options } },
      })
      start.catch(() => {})
      const recorder = await context.waitForEvent('page', {
        predicate: (p) => p.url().endsWith('/recorder.html'),
      })
      await recorder.waitForLoadState()
      await pause(900)
      return { start, recorder, bounds: await recorder.evaluate(() => chrome.windows.getCurrent()) }
    }
    if (!injected) {
      const popupDOM = JSON.parse(report.actualPopupDOM)
      // Fractional CSS pixels at 125% round innerHeight down and scrollHeight up.
      assert.ok(popupDOM.scrollHeight - popupDOM.height <= 1)
      const shotData = await popupCommand('Page.captureScreenshot', {
        captureBeyondViewport: false,
      })
      await writeFile(resolve(out, 'actual-action-popup.png'), Buffer.from(shotData.data, 'base64'))
      const firstPage = context.waitForEvent('page', {
        predicate: (p) => p.url().endsWith('/recorder.html'),
      })
      const button = popupDOM.button
      await popupCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        x: button.x + button.width / 2,
        y: button.y + button.height / 2,
      })
      await popupCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        x: button.x + button.width / 2,
        y: button.y + button.height / 2,
      })
      const first = await firstPage
      await first.waitForLoadState()
      await pause(900)
      await shot('native-tab-audio')
      const busy = await send('startRecording', { tabId, title: 'Duplicate' })
      assert.match(JSON.stringify(busy), /RecorderBusyError/)
      execFileSync('xdotool', ['key', '--clearmodifiers', 'Escape'], { env })
      if (!first.isClosed()) await first.waitForEvent('close')
      assert.equal((await status()).state, 'idle')
      assert.match((await status()).startError, /CaptureCancelledError/)
      report.cases.push({ action: 'cancel from actual popup CTA', busy, status: await status() })
      const second = await launch('close')
      await control.evaluate((id) => chrome.windows.remove(id), second.bounds.id)
      assert.ok((await second.start).err)
      if (!second.recorder.isClosed()) await second.recorder.waitForEvent('close')
      report.cases.push({ action: 'close', status: await status() })
      // The click geometry below is specific to Chromium 156; evidence records the real native UI.
      for (const scenario of [
        { kind: 'tab' },
        { kind: 'window' },
        { kind: 'screen' },
        { kind: 'tab', audio: true },
      ]) {
        const kind = scenario.kind
        const label = kind + (scenario.audio ? '-with-audio' : '')
        const {
          start,
          recorder,
          bounds: b,
        } = await launch(label, {
          sourceAudio: Boolean(scenario.audio),
          mode: scenario.audio ? 'audio' : 'video',
        })
        const click = (x, y) =>
          execFileSync(
            'xdotool',
            [
              'mousemove',
              String(Math.round(x * report.screen.scale)),
              String(Math.round(y * report.screen.scale)),
              'click',
              '1',
            ],
            { env },
          )
        if (kind === 'window') click(b.left + b.width / 2, b.top + 93)
        if (kind === 'screen') click(b.left + b.width / 2 + 180, b.top + 93)
        await pause(200)
        await shot('native-' + label)
        // select first list item/thumbnail, then Share (positions verified in screenshots)
        click(b.left + b.width / 2 - 135, b.top + (kind === 'tab' ? 180 : 190))
        await pause(200)
        await shot('native-' + label + '-selected')
        const tsv = execFileSync(
          'tesseract',
          [resolve(out, 'native-' + label + '-selected.png'), 'stdout', 'tsv'],
          { encoding: 'utf8' },
        )
        await writeFile(resolve(out, 'native-' + label + '-selected.tsv'), tsv)
        const cancel = tsv
          .split('\n')
          .map((line) => line.split('\t'))
          .filter((row) => row[11]?.trim().toLowerCase() === 'cancel')
          .at(-1)
        assert.ok(cancel, 'Cannot locate native dialog buttons')
        click(
          (Number(cancel[6]) + Number(cancel[8]) / 2) / report.screen.scale + 86,
          (Number(cancel[7]) + Number(cancel[9]) / 2) / report.screen.scale,
        )
        const result = await Promise.race([
          start,
          pause(12000).then(() => {
            throw new Error('Share click did not complete ' + kind)
          }),
        ])
        assert.equal(result.res?.state, 'recording', JSON.stringify(result))
        assert.equal(result.res.session.videoSource, kind)
        await pause(1600)
        assert.equal((await send('pauseRecording')).res.state, 'paused')
        assert.equal((await send('resumeRecording')).res.state, 'recording')
        await send('stopRecording')
        if (!recorder.isClosed()) await recorder.waitForEvent('close')
        const recording = await readRecording(result.res.session.id)
        assert.equal(recording.manifest.videoSource, kind)
        if (scenario.audio) {
          assert.ok(recording.manifest.tracks.audio.bytes > 0)
          assert.ok(recording.signal.source440 > 0.02, JSON.stringify(recording.signal))
          assert.equal(recording.manifest.tracks.video, undefined)
        } else {
          assert.equal(recording.meeting.media.audio, undefined)
          assert.ok(recording.manifest.tracks.video.bytes > 0)
        }
        report.cases.push({
          kind,
          bounds: b,
          audio: scenario.audio,
          result,
          recording,
          status: await status(),
        })
        await send('dismissRecordingNotice')
      }
    } else {
      for (const c of [
        {
          name: 'denied',
          surface: 'window',
          granted: false,
          sourceAudio: true,
          microphone: true,
          reject: 'SourceAudioUnavailableError',
        },
        {
          name: 'missing-track',
          surface: 'window',
          granted: true,
          sourceAudio: true,
          microphone: true,
          missingTrack: true,
          reject: 'WindowAudioUnavailableError',
        },
        {
          name: 'tab-mixed',
          surface: 'browser',
          granted: true,
          sourceAudio: true,
          microphone: true,
          mode: 'audio',
          kind: 'tab',
        },
        {
          name: 'window-mic',
          surface: 'window',
          granted: false,
          sourceAudio: false,
          microphone: true,
          mode: 'audio',
          kind: 'window',
        },
        {
          name: 'screen-silent',
          surface: 'monitor',
          granted: false,
          sourceAudio: false,
          microphone: false,
          kind: 'screen',
        },
        {
          name: 'unreported',
          granted: false,
          sourceAudio: false,
          microphone: false,
          reject: 'CaptureFailedError',
        },
      ]) {
        await control.evaluate(async (c) => {
          window.events = []
          await chrome.storage.local.set({ u95Case: c })
        }, c)
        const pending = send('startRecording', {
          tabId,
          title: 'U95 ' + c.name,
          settings: { mode: c.mode || 'video', prefs: { ...prefs, ...c } },
        })
        const result = await pending
        if (c.reject) {
          assert.match(JSON.stringify(result), new RegExp(c.reject))
          assert.equal((await status()).state, 'idle')
        } else {
          assert.equal(result.res?.state, 'recording', JSON.stringify(result))
          assert.equal(result.res.session.videoSource, c.kind)
          await pause(1400)
          assert.equal((await send('pauseRecording')).res.state, 'paused')
          assert.equal((await send('resumeRecording')).res.state, 'recording')
          await send('stopRecording')
          await pause(1700)
        }
        const events = await control.evaluate(() => window.events),
          recording = c.reject ? undefined : await readRecording(result.res.session.id)
        if (c.name === 'denied') assert.equal(events.filter((e) => e.type === 'media').length, 0)
        if (c.name === 'missing-track')
          assert.equal(events.filter((e) => e.type === 'media').length, 1)
        if (c.name === 'tab-mixed') {
          assert.ok(recording.signal.source440 > 0.02)
          assert.ok(recording.signal.mic880 > 0.02)
          assert.equal(recording.signal.channels, 1)
        }
        if (c.name === 'window-mic') {
          assert.ok(recording.signal.source440 < 0.002)
          assert.ok(recording.signal.mic880 > 0.02)
        }
        if (c.name === 'screen-silent') assert.equal(recording.meeting.media.audio, undefined)
        const hosts = await control.evaluate(
          async () =>
            (await chrome.tabs.query({})).filter((t) => t.url?.endsWith('/recorder.html')).length,
        )
        assert.equal(hosts, 0)
        report.cases.push({ case: c, result, events, recording, hosts })
        await send('dismissRecordingNotice')
      }
    }
  }
  report.passed = true
} catch (error) {
  report.error = String(error.stack || error)
  process.exitCode = 1
} finally {
  if (context) await context.close()
  await new Promise((r) => server.close(r))
  for (const child of [wm, xvfb])
    if (child && child.exitCode === null && child.signalCode === null) {
      const q = new Promise((r) => child.once('exit', r))
      child.kill('SIGTERM')
      await q
    }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
