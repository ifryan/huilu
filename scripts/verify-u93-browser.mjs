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
const auditSharing = process.env.AUDIT_SHARING_UI === '1'
const out = resolve(
  root,
  'output/playwright',
  `${auditSharing ? 'U-94' : 'U-93'}-${process.env.EVIDENCE_LABEL || (baseline ? 'baseline' : injected ? 'injected' : 'native')}-${Date.now()}`,
)
const ext = resolve(out, 'extension')
await mkdir(out, { recursive: true })
await cp(
  process.env.EXTENSION_BUILD || baseline || resolve(root, 'apps/extension/.output/chrome-mv3'),
  ext,
  { recursive: true },
)
await writeFile(resolve(ext, 'u93-harness.html'), '<!doctype html><title>U93 control</title>')
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
    `<!doctype html><title>U93 sample meeting</title><h1>Meeting source</h1><button onclick="window.ctx=new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=440;g.gain.value=.2;o.connect(g).connect(ctx.destination);o.start()">Play 440 Hz</button>`,
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
let context, wm
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const report = {
  injected,
  baseline: Boolean(baseline),
  auditSharing,
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
      const log = (event) => chrome.runtime.sendMessage({ u93Event: event })
      const config = new URLSearchParams(location.search)
      void config
      chrome.desktopCapture.chooseDesktopMedia = (sources, callback) => {
        void chrome.storage.local
          .get('u93Case')
          .then(({ u93Case: c }) =>
            log({ type: 'picker', sources }).then(() =>
              callback('injected-desktop', { canRequestAudioTrack: c.granted }),
            ),
          )
        return 95
      }
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const { u93Case: c } = await chrome.storage.local.get('u93Case')
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
  await control.goto(base + '/u93-harness.html')
  await control.evaluate(() => {
    window.events = []
    chrome.runtime.onMessage.addListener((m) => {
      if (m.u93Event) window.events.push(m.u93Event)
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
  report.browser = context.browser().version()
  report.screen = await control.evaluate(() => ({
    width: screen.availWidth,
    height: screen.availHeight,
    scale: devicePixelRatio,
  }))
  await control.evaluate(
    (prefs) =>
      chrome.storage.local.set({ onboarded: true, locale: 'zh-CN', recordingPrefs: prefs }),
    prefs,
  )
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
  const snapshot = async (name) => {
    await pause(1200)
    const state = await control.evaluate(async () => ({
      windows: await chrome.windows.getAll(),
      tabs: await chrome.tabs.query({}),
    }))
    state.overlays = await source.locator('huilu-recording-panel').count()
    state.status = await status()
    await source.screenshot({ path: resolve(out, name + '-page.png') })
    await shot(name + '-desktop')
    report.ui.push({ name, ...state })
    return state
  }
  const sourceSession = await context.newCDPSession(source)
  const panelClick = async (name) => {
    const ax = await sourceSession.send('Accessibility.getFullAXTree')
    const target = ax.nodes.find(
      (n) =>
        n.role?.value === 'button' && (n.name?.value === name || n.description?.value === name),
    )
    assert.ok(
      target,
      'Missing panel button ' +
        name +
        ': ' +
        JSON.stringify(
          ax.nodes
            .filter((n) => n.role?.value === 'button')
            .map((n) => ({ name: n.name, description: n.description })),
        ),
    )
    const { model } = await sourceSession.send('DOM.getBoxModel', {
      backendNodeId: target.backendDOMNodeId,
    })
    const q = model.content
    await source.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2)
    await pause(300)
  }
  const browserSession = await context.browser().newBrowserCDPSession()
  let popupSession,
    popupCommandId = 0
  const popupCommand = async (method, params = {}) => {
    const id = ++popupCommandId
    const answer = new Promise((resolve, reject) => {
      const listener = (event) => {
        if (event.sessionId !== popupSession) return
        const message = JSON.parse(event.message)
        if (message.id !== id) return
        browserSession.off('Target.receivedMessageFromTarget', listener)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      }
      browserSession.on('Target.receivedMessageFromTarget', listener)
    })
    await browserSession.send('Target.sendMessageToTarget', {
      sessionId: popupSession,
      message: JSON.stringify({ id, method, params }),
    })
    return answer
  }
  const toolbar = async (name, restore = false) => {
    await source.bringToFront()
    await control.evaluate(() => chrome.action.openPopup())
    await pause(500)
    const { targetInfos } = await browserSession.send('Target.getTargets')
    const target = targetInfos.find((t) => t.url.endsWith('/popup.html'))
    assert.ok(target, 'Actual toolbar popup did not open')
    popupSession = (
      await browserSession.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: false,
      })
    ).sessionId
    const result = await popupCommand('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    })
    const shotData = await popupCommand('Page.captureScreenshot', { captureBeyondViewport: false })
    await writeFile(resolve(out, name + '-popup.png'), Buffer.from(shotData.data, 'base64'))
    report.ui.push({ name, toolbarText: result.result.value })
    if (restore) {
      const clicked = await popupCommand('Runtime.evaluate', {
        expression: `Boolean([...document.querySelectorAll('button')].find(b=> /^(显示录制面板|Show recording panel)$/.test(b.textContent.trim()))?.click() ?? false)`,
        returnByValue: true,
      })
      void clicked
      await pause(1400)
      assert.equal(await source.locator('huilu-recording-panel').count(), 1)
    } else {
      await source.bringToFront()
      execFileSync('xdotool', ['key', '--clearmodifiers', 'Escape'], { env })
    }
  }
  const restorePanel = async () => toolbar('restore-' + Date.now(), true)
  // U-94: browser chrome is outside the page/closed Shadow DOM. Inspect both boundaries.
  const inspectLayers = async (name) => {
    await sourceSession.send('DOM.enable')
    await sourceSession.send('CSS.enable')
    const { root: document } = await sourceSession.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })
    const nodes = []
    const visit = (node) => {
      nodes.push(node)
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child)
    }
    visit(document)
    const classes = (node) => {
      const i = node.attributes?.indexOf('class') ?? -1
      return i < 0 ? [] : node.attributes[i + 1].split(/\s+/)
    }
    const host = nodes.filter((n) => n.nodeName === 'HUILU-RECORDING-PANEL')
    const layers = nodes.filter((n) => classes(n).includes('huilu-panel-layer'))
    const panels = nodes.filter((n) => classes(n).includes('huilu-panel'))
    const surfaces = []
    for (const node of nodes.filter((n) => n.nodeName === 'SECTION' || layers.includes(n))) {
      const { computedStyle } = await sourceSession.send('CSS.getComputedStyleForNode', {
        nodeId: node.nodeId,
      })
      surfaces.push({
        tag: node.nodeName,
        classes: classes(node),
        style: Object.fromEntries(
          computedStyle
            .filter((s) =>
              /^(background-color|box-shadow|border-top-width|padding-top)$/.test(s.name),
            )
            .map((s) => [s.name, s.value]),
        ),
      })
    }
    const x11 = execFileSync('xwininfo', ['-root', '-tree'], { env, encoding: 'utf8' })
    await writeFile(resolve(out, name + '-x11.txt'), x11)
    const nativeWindows = x11.split('\n').filter((line) => /HuiLu is sharing/.test(line))
    const nativeWindowInfo = nativeWindows.map((line) =>
      execFileSync('xwininfo', ['-id', line.trim().split(' ')[0]], { env, encoding: 'utf8' }),
    )
    const result = {
      name,
      hosts: host.length,
      shadowRoots: host.flatMap((n) => n.shadowRoots || []).map((n) => n.shadowRootType),
      layers: layers.length,
      panels: panels.length,
      nativeTextInPage: nodes.some((n) =>
        /HuiLu is sharing (a window|your screen)/.test(n.nodeValue || ''),
      ),
      surfaces,
      nativeWindows,
      nativeWindowInfo,
    }
    report.ui.push(result)
    assert.equal(result.nativeTextInPage, false)
    assert.ok(result.hosts <= 1)
    assert.equal(result.layers, result.hosts)
    assert.equal(result.panels, result.hosts)
    assert.equal(result.shadowRoots.length, result.hosts)
    return result
  }
  const auditNativeBar = async (kind) => {
    const prefix = 'sharing-' + kind
    const before = await inspectLayers(prefix + '-before')
    assert.equal(before.hosts, 1)
    assert.equal(before.nativeWindows.length, 1, JSON.stringify(before.nativeWindows))
    assert.match(before.nativeWindowInfo[0], /Map State: IsViewable/)
    const card = before.surfaces.filter((s) => s.tag === 'SECTION').at(-1)
    if (process.env.EXTENSION_BUILD)
      assert.notEqual(card.style['background-color'], 'rgba(0, 0, 0, 0)')
    else assert.equal(card.style['background-color'], 'rgba(0, 0, 0, 0)')
    await shot(prefix + '-before-desktop')
    // Close only our page controls. The native sharing bar must remain independently visible.
    await panelClick('关闭面板')
    await snapshot(prefix + '-page-controls-closed')
    const closed = await inspectLayers(prefix + '-page-controls-closed')
    assert.equal(closed.hosts, 0)
    assert.equal(closed.nativeWindows.length, 1)
    assert.equal((await status()).state, 'recording')
    await restorePanel()
    await panelClick('收起')
    await snapshot(prefix + '-collapsed')
    await panelClick('展开录制面板')
    await shot(prefix + '-hide-target')
    const info = before.nativeWindowInfo[0]
    const nativeX = Number(info.match(/Absolute upper-left X:\s+(\d+)/)[1])
    const nativeY = Number(info.match(/Absolute upper-left Y:\s+(\d+)/)[1])
    const nativeWidth = Number(info.match(/Width:\s+(\d+)/)[1])
    const nativeHeight = Number(info.match(/Height:\s+(\d+)/)[1])
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      resolve(out, prefix + '-hide-target.png'),
      '-vf',
      `crop=${nativeWidth}:${nativeHeight}:${nativeX}:${nativeY},scale=iw*3:ih*3`,
      resolve(out, prefix + '-native-bar.png'),
    ])
    const tsv = execFileSync(
      'tesseract',
      [resolve(out, prefix + '-native-bar.png'), 'stdout', '--psm', '6', 'tsv'],
      { encoding: 'utf8' },
    )
    await writeFile(resolve(out, prefix + '-hide-target.tsv'), tsv)
    const hide = tsv
      .split('\n')
      .map((line) => line.split('\t'))
      .find((r) => r[11]?.toLowerCase() === 'hide')
    // Orange text is often omitted by OCR. Fallback uses the rightmost Hide control
    // visually verified in the saved Chromium 156 crop, relative to the X11 widget.
    const hideClick = {
      method: hide ? 'ocr' : 'verified-chromium-156-geometry',
      x: Math.round(
        nativeX +
          (hide
            ? (Number(hide[6]) + Number(hide[8]) / 2) / 3
            : nativeWidth - 32 * report.screen.scale),
      ),
      y: Math.round(
        nativeY + (hide ? (Number(hide[7]) + Number(hide[9]) / 2) / 3 : nativeHeight / 2),
      ),
    }
    // Real user action on Chrome UI, never a production API/flag to hide the indicator.
    execFileSync('xdotool', ['mousemove', String(hideClick.x), String(hideClick.y), 'click', '1'], {
      env,
    })
    await snapshot(prefix + '-after-hide')
    const after = await inspectLayers(prefix + '-after-hide')
    assert.equal(after.hosts, 1)
    assert.ok(after.nativeWindowInfo.every((info) => !info.includes('Map State: IsViewable')))
    assert.equal((await status()).state, 'recording')
    const afterTsv = execFileSync(
      'tesseract',
      [resolve(out, prefix + '-after-hide-desktop.png'), 'stdout', 'tsv'],
      { encoding: 'utf8' },
    )
    assert.equal(
      afterTsv.split('\n').some((line) => line.split('\t')[11]?.toLowerCase() === 'hide'),
      false,
    )
    report.cases.push({
      action: 'native-hide',
      kind,
      hideClick,
      before,
      after,
      status: await status(),
    })
  }
  await pause(700)
  for (const page of context.pages()) if (page !== control && page !== source) await page.close()
  await source.bringToFront()
  await snapshot('idle')
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
    const opened = context.waitForEvent('page')
    opened.catch(() => {})
    const start = send('startRecording', {
      tabId,
      title: 'U93 ' + name,
      settings: { mode: options.mode || 'video', prefs: { ...prefs, ...options } },
    })
    start.catch(() => {})
    const recorder = await Promise.race([
      opened,
      start.then((result) => {
        assert.equal(result.err, undefined, JSON.stringify(result))
        return opened
      }),
    ])
    await recorder.waitForURL('**/recorder.html')
    await recorder.waitForLoadState()
    await pause(900)
    return { start, recorder, bounds: await recorder.evaluate(() => chrome.windows.getCurrent()) }
  }
  if (!injected) {
    const cancel = await launch('cancel')
    await snapshot('choosing')
    const busy = await send('startRecording', { tabId, title: 'Duplicate' })
    assert.match(JSON.stringify(busy), /RecorderBusyError/)
    execFileSync('xdotool', ['key', '--clearmodifiers', 'Escape'], { env })
    assert.ok((await cancel.start).err)
    if (!cancel.recorder.isClosed()) await cancel.recorder.waitForEvent('close')
    const cancelled = await snapshot('cancelled')
    await toolbar('cancelled')
    assert.equal(cancelled.status.state, 'idle')
    assert.equal(cancelled.overlays, baseline ? 1 : 0)
    report.cases.push({ action: 'cancel', busy, status: await status() })
    await send('dismissRecordingNotice')
    const second = await launch('close')
    await second.recorder.close()
    assert.ok((await second.start).err)
    if (!second.recorder.isClosed()) await second.recorder.waitForEvent('close')
    await snapshot('closed-picker')
    report.cases.push({ action: 'close', status: await status() })
    await send('dismissRecordingNotice')
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
      const words = async (name) => {
        await shot(name)
        const tsv = execFileSync('tesseract', [resolve(out, name + '.png'), 'stdout', 'tsv'], {
          encoding: 'utf8',
        })
        await writeFile(resolve(out, name + '.tsv'), tsv)
        return tsv
          .split('\n')
          .map((line) => line.split('\t'))
          .filter((row) => row.length >= 12)
      }
      const word = (rows, text) => rows.find((row) => row[11]?.trim().toLowerCase() === text)
      const clickWord = (row) => {
        assert.ok(row, 'Native picker text not found')
        click(
          (Number(row[6]) + Number(row[8]) / 2) / report.screen.scale,
          (Number(row[7]) + Number(row[9]) / 2) / report.screen.scale,
        )
      }
      let rows = await words('native-' + label)
      const heading = word(rows, 'chromium') ?? word(rows, 'entire')
      assert.ok(heading, 'Native picker source tabs not found')
      const headingY = (Number(heading[7]) + Number(heading[9]) / 2) / report.screen.scale
      if (kind === 'window') click(b.left + b.width / 2, headingY)
      if (kind === 'screen') click(b.left + b.width / 2 + 185, headingY)
      await pause(250)
      rows = await words('native-' + label + '-sources')
      if (kind === 'tab') clickWord(word(rows, 'sample'))
      else {
        click(b.left + b.width / 2 - 135, headingY + 100)
      }
      await pause(250)
      await shot('native-' + label + '-selected')
      const tsv = execFileSync(
        'tesseract',
        [resolve(out, 'native-' + label + '-selected.png'), 'stdout', 'tsv'],
        { encoding: 'utf8' },
      )
      await writeFile(resolve(out, 'native-' + label + '-selected.tsv'), tsv)
      let cancel = tsv
        .split('\n')
        .map((line) => line.split('\t'))
        .filter((row) => row[11]?.trim().toLowerCase() === 'cancel')
        .at(-1)
      if (!cancel) {
        const retry = execFileSync(
          'tesseract',
          [resolve(out, 'native-' + label + '-selected.png'), 'stdout', '--psm', '6', 'tsv'],
          { encoding: 'utf8' },
        )
        cancel = retry
          .split('\n')
          .map((line) => line.split('\t'))
          .filter((row) => row[11]?.trim().toLowerCase() === 'cancel')
          .at(-1)
      }
      if (cancel)
        click(
          (Number(cancel[6]) + Number(cancel[8]) / 2) / report.screen.scale + 86,
          (Number(cancel[7]) + Number(cancel[9]) / 2) / report.screen.scale,
        )
      else {
        // Chromium 156 geometry, visually verified in the saved selected-source screenshot.
        click(b.left + b.width / 2 + 245, headingY + (scenario.audio ? 450 : 402))
      }
      const result = await Promise.race([
        start,
        pause(12000).then(() => {
          throw new Error('Share click did not complete ' + kind)
        }),
      ])
      assert.equal(result.res?.state, 'recording', JSON.stringify(result))
      assert.equal(result.res.session.videoSource, kind)
      await pause(1600)
      const active = await snapshot('recording-' + label)
      if (auditSharing && (kind === 'window' || kind === 'screen')) await auditNativeBar(kind)
      const host = active.tabs.find((t) => t.url?.endsWith('/recorder.html'))
      const origin = active.tabs.find((t) => t.id === tabId)
      assert.ok(host)
      if (!baseline) {
        assert.equal(host.windowId, origin.windowId)
        assert.equal(host.active, false)
        assert.equal(active.windows.filter((w) => w.type === 'popup').length, 0)
        assert.equal(origin.active, true)
      }
      assert.equal((await send('pauseRecording')).res.state, 'paused')
      await snapshot('paused-' + label)
      assert.equal((await send('resumeRecording')).res.state, 'recording')
      if (scenario.audio) {
        for (const locale of ['zh-CN', 'en']) {
          await control.evaluate((locale) => chrome.storage.local.set({ locale }), locale)
          await pause(500)
          await panelClick(locale === 'en' ? 'Close panel' : '关闭面板')
          await pause(300)
          assert.equal(await source.locator('huilu-recording-panel').count(), baseline ? 1 : 0)
          assert.equal((await status()).state, 'recording')
          await restorePanel()
          await snapshot('restored-' + locale)
        }
        await source.reload()
        await pause(500)
        const refreshed = await snapshot('navigation-refresh')
        assert.equal(refreshed.overlays, 0)
        assert.equal(refreshed.status.state, 'recording')
        await source.goto(`http://127.0.0.1:${server.address().port}/next`)
        await source.getByRole('button').click()
        assert.equal((await status()).state, 'recording')
        await restorePanel()
        await snapshot('navigation-restored')
        // Operate the recovered overlay, including stop confirmation.
        await panelClick('Pause')
        assert.equal((await status()).state, 'paused')
        await panelClick('Resume')
        assert.equal((await status()).state, 'recording')
        await panelClick('Stop')
        await panelClick('Stop recording')
      } else await send('stopRecording')
      if (!recorder.isClosed()) await recorder.waitForEvent('close')
      const ended = await snapshot('ended-' + label)
      assert.equal(ended.overlays, baseline ? 1 : 0)
      if (scenario.audio) await toolbar('saved')
      assert.equal(ended.tabs.filter((t) => t.url?.endsWith('/recorder.html')).length, 0)
      assert.ok(
        ended.tabs.some((t) => t.id === tabId),
        'Never close the user browser window',
      )
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
        await chrome.storage.local.set({ u93Case: c })
      }, c)
      const pending = send('startRecording', {
        tabId,
        title: 'U93 ' + c.name,
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
  if (injected && !baseline) {
    await control.evaluate(() =>
      chrome.storage.local.set({ u93Case: { surface: 'browser', granted: true } }),
    )
    const opened = context.waitForEvent('page')
    const pending = send('startRecording', {
      tabId,
      title: 'U93 interruption',
      settings: { mode: 'audio', prefs },
    })
    const recorder = await opened
    await recorder.waitForURL('**/recorder.html')
    const started = await pending
    assert.equal(started.res?.state, 'recording')
    await pause(6500)
    await recorder.close()
    await pause(500)
    const interrupted = await snapshot('host-closed')
    assert.equal(interrupted.status.state, 'idle')
    assert.equal(interrupted.status.lastResult.error, 'RecorderWindowClosed')
    const unfinished = (await send('listUnfinishedRecordings')).res
    assert.ok(unfinished.some((r) => r.id === started.res.session.id))
    const recovered = await send('recoverRecording', started.res.session.id)
    assert.equal(recovered.res.saved, true)
    report.cases.push({
      action: 'forced-host-close-and-recover',
      started,
      unfinished,
      recovered,
      recording: await readRecording(started.res.session.id),
    })
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
