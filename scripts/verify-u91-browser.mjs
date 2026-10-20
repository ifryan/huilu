// Run after pnpm build. Picker and desktop devices are injected in an isolated profile.
// The optional tab case uses the shipped service worker -> offscreen path, without injection.
/* global chrome */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'output/playwright', `U-91-${Date.now()}`)
const ext = resolve(out, 'extension')
await mkdir(out, { recursive: true })
await cp(resolve(root, 'apps/extension/.output/chrome-mv3'), ext, { recursive: true })
await writeFile(resolve(ext, 'u91-harness.html'), '<!doctype html><title>U-91 control</title>')
// Observe real offscreen constraints/results; do not replace its getUserMedia implementation.
await writeFile(
  resolve(ext, 'u91-offscreen-probe.js'),
  `const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const probe = { constraints, context: location.pathname };
    try {
      const stream = await original(constraints);
      probe.tracks = stream.getTracks().map(t => ({ kind: t.kind, state: t.readyState }));
      chrome.runtime.sendMessage({u91Probe: probe});
      return stream;
    } catch (error) {
      chrome.runtime.sendMessage({u91Probe: {...probe, error: error.name + ': ' + error.message}});
      throw error;
    }
  };`,
)
const offscreenHtml = resolve(ext, 'offscreen.html')
await writeFile(
  offscreenHtml,
  (await readFile(offscreenHtml, 'utf8')).replace(
    '<head>',
    '<head><script src="/u91-offscreen-probe.js"></script>',
  ),
)

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright-core'
)
const id = 'fddknloecifbbeomieckhnegffdobgni'
const base = `chrome-extension://${id}`
let context
const report = {
  desktopBoundary: 'Injected native picker callback and canvas/mic streams in recorder.html only',
  exercised: 'Built popup, service worker, visible recorder, Web Audio/MediaRecorder, OPFS',
  nativePicker: 'Not automated; user attachment inspected separately',
  physicalMicrophone: 'Not tested; generated 880 Hz tone',
  cases: {},
}
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end(`<!doctype html><title>U91 440 Hz source</title><button onclick="
    window.ctx=new AudioContext();const o=ctx.createOscillator(),g=ctx.createGain();
    o.frequency.value=440;g.gain.value=.2;o.connect(g).connect(ctx.destination);o.start();
  ">Play test tone</button>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}`

try {
  context = await chromium.launchPersistentContext(resolve(out, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH,
    headless: false,
    // Use native screen/window metrics: viewport emulation invents a larger screen than
    // headless Chrome actually has, causing windows.update bounds validation to fail.
    viewport: null,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--no-proxy-server',
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      `--allowlisted-extension-id=${id}`,
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
    ],
  })
  context.setDefaultTimeout(10000)
  report.browser = context.browser()?.version()
  await context.addInitScript(() => {
    if (location.pathname !== '/recorder.html') return
    const log = (event) => chrome.runtime.sendMessage({ u91Event: event })
    const contexts = []
    const wrapTrack = (track) => {
      const stop = track.stop.bind(track)
      track.stop = () => {
        void log({ type: 'stop', kind: track.kind })
        stop()
      }
      return track
    }
    chrome.desktopCapture.chooseDesktopMedia = (sources, callback) => {
      void log({ type: 'picker', sources }).then(() =>
        callback('u91-window-token', { canRequestAudioTrack: false }),
      )
      return 91
    }
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await log({ type: 'getUserMedia', constraints })
      if (constraints.video) {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const ctx = canvas.getContext('2d')
        const paint = () => {
          ctx.fillStyle = '#eee'
          ctx.fillRect(0, 0, 640, 360)
          ctx.fillStyle = '#111'
          ctx.font = '28px sans-serif'
          ctx.fillText('U-91 generated window / ' + Date.now(), 20, 80)
          requestAnimationFrame(paint)
        }
        paint()
        const stream = canvas.captureStream(15)
        stream.getTracks().forEach(wrapTrack)
        return stream
      }
      const ctx = new AudioContext()
      contexts.push(ctx)
      const osc = ctx.createOscillator(),
        gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.2
      const dest = ctx.createMediaStreamDestination()
      osc.connect(gain).connect(dest)
      osc.start()
      dest.stream.getTracks().forEach(wrapTrack)
      return dest.stream
    }
    window.addEventListener('unload', () => contexts.forEach((c) => void c.close()))
  })
  const control = await context.newPage()
  await control.goto(`${base}/u91-harness.html`)
  await control.evaluate(() => {
    window.probes = []
    window.events = []
    chrome.runtime.onMessage.addListener((m) => {
      if (m.u91Probe) window.probes.push(m.u91Probe)
      if (m.u91Event) window.events.push(m.u91Event)
    })
  })
  const send = (type, data) =>
    control.evaluate(
      ({ type, data }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out sending ${type}`)), 15000)
          chrome.runtime.sendMessage({ id: Date.now(), type, data, timestamp: Date.now() }, (r) => {
            clearTimeout(timer)
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
            else resolve(r)
          })
        }),
      { type, data },
    )
  const status = async () => (await send('getRecorderStatus')).res
  const source = await context.newPage()
  await source.goto(url)
  const tabId = await control.evaluate(async (url) => {
    return (await chrome.tabs.query({})).find((t) => t.url === url).id
  }, url + '/')
  const prefs = {
    videoSource: 'window',
    sourceAudio: true,
    microphone: true,
    quality: { resolution: '720p', fps: 15 },
    language: 'zh',
  }
  await control.evaluate(async (prefs) => {
    await chrome.storage.local.set({ onboarded: true, locale: 'zh-CN', recordingPrefs: prefs })
  }, prefs)
  const popup = await context.newPage()
  await popup.goto(`${base}/popup.html`)
  await popup.getByText('下一步选择标签页、窗口或屏幕。', { exact: false }).waitFor()
  await popup.locator('main').screenshot({ path: resolve(out, 'unified-source-hint-zh.png') })
  // Keep a popup tab open for evidence; send the same request as its Start button.
  const rejected = await send('startRecording', {
    tabId,
    title: 'U-91 denied window audio',
    settings: { mode: 'audio', prefs },
  })
  assert.ok(rejected.err, JSON.stringify(rejected))
  const deniedStatus = await status()
  assert.equal(deniedStatus.state, 'idle')
  assert.match(deniedStatus.startError, /WindowAudioUnavailableError/)
  await popup.getByText('所选窗口未提供音频，录制未开始。', { exact: false }).waitFor()
  await popup.locator('main').screenshot({ path: resolve(out, 'window-error-zh.png') })
  const deniedEvents = await control.evaluate(() => window.events)
  assert.deepEqual(deniedEvents, [{ type: 'picker', sources: ['window', 'audio'] }])
  const recorderWindows = await control.evaluate(
    async () =>
      (await chrome.tabs.query({})).filter((t) => t.url?.endsWith('/recorder.html')).length,
  )
  assert.equal(recorderWindows, 0)
  report.cases.deniedWindowAudio = { rejected, deniedStatus, deniedEvents, recorderWindows }
  await control.evaluate(() => chrome.storage.local.set({ locale: 'en' }))
  await popup.getByText('The selected window did not provide audio', { exact: false }).waitFor()
  await popup.locator('main').screenshot({ path: resolve(out, 'window-error-en.png') })

  const readRecording = async (meetingId) =>
    control.evaluate(async (meetingId) => {
      const dir = await (
        await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings')
      ).getDirectoryHandle(meetingId)
      const manifest = JSON.parse(
        await (await (await dir.getFileHandle('manifest.json')).getFile()).text(),
      )
      const meeting = JSON.parse(
        await (await (await dir.getFileHandle('meeting.json')).getFile()).text(),
      )
      let signal
      if (manifest.tracks.audio) {
        const audio = await dir.getDirectoryHandle('audio')
        const blobs = []
        for (let i = 1; i <= manifest.tracks.audio.chunks; i++) {
          blobs.push(
            await (await audio.getFileHandle(String(i).padStart(6, '0') + '.part')).getFile(),
          )
        }
        const ctx = new AudioContext()
        try {
          const decoded = await ctx.decodeAudioData(await new Blob(blobs).arrayBuffer())
          const values = decoded.getChannelData(0),
            from = Math.round(decoded.sampleRate * 0.3)
          const n = Math.min(decoded.sampleRate, values.length - from)
          const amplitude = (frequency) => {
            let re = 0,
              im = 0
            for (let i = 0; i < n; i++) {
              const a = (2 * Math.PI * frequency * i) / decoded.sampleRate
              re += values[from + i] * Math.cos(a)
              im += values[from + i] * Math.sin(a)
            }
            return (2 * Math.hypot(re, im)) / n
          }
          signal = {
            source440: amplitude(440),
            mic880: amplitude(880),
            channels: decoded.numberOfChannels,
          }
        } finally {
          await ctx.close()
        }
      }
      return { manifest, meeting, signal }
    }, meetingId)

  for (const [name, mode, microphone] of [
    ['windowMicOnly', 'audio', true],
    ['windowSilentVideo', 'video', false],
  ]) {
    await control.evaluate(() => {
      window.events = []
    })
    const result = await send('startRecording', {
      tabId,
      title: 'U-91 ' + name,
      settings: { mode, prefs: { ...prefs, sourceAudio: false, microphone } },
    })
    assert.equal(result.res?.state, 'recording', JSON.stringify(result))
    assert.equal((await status()).startError, undefined)
    await popup.getByText('U-91 ' + name, { exact: true }).waitFor()
    await popup.locator('main').screenshot({ path: resolve(out, `${name}.png`) })
    await new Promise((r) => setTimeout(r, 1800))
    const stopped = await send('stopRecording')
    assert.equal(stopped.res?.state, 'idle', JSON.stringify(stopped))
    const recording = await readRecording(result.res.session.id)
    const events = await control.evaluate(() => window.events)
    assert.deepEqual(events.find((e) => e.type === 'picker').sources, ['window'])
    const sourceRequest = events.find((e) => e.type === 'getUserMedia')
    assert.equal(sourceRequest.constraints.audio, false)
    assert.ok(events.some((e) => e.type === 'stop' && e.kind === 'video'))
    if (microphone) {
      assert.ok(recording.manifest.tracks.audio.bytes > 0)
      assert.ok(recording.signal.mic880 > 0.02)
      assert.ok(recording.signal.source440 < 0.002)
      assert.ok(events.some((e) => e.type === 'stop' && e.kind === 'audio'))
    } else {
      assert.equal(recording.manifest.tracks.audio, undefined)
      assert.equal(recording.meeting.media.audio, undefined)
      assert.ok(recording.manifest.tracks.video.bytes > 0)
    }
    report.cases[name] = { state: stopped.res.state, ...recording, events }
    await send('dismissRecordingNotice')
  }

  report.desktopCasesPassed = true

  // Native tab audio: use the actual shipped service worker and offscreen consumer.
  await source.getByRole('button', { name: 'Play test tone' }).click()
  const tabStart = await send('startRecording', {
    tabId,
    title: 'U-91 real tab audio',
    settings: {
      mode: 'audio',
      prefs: { ...prefs, videoSource: 'tab', sourceAudio: true, microphone: false },
    },
  })
  report.cases.nativeTab = {
    start: tabStart,
    authorization: 'allowlisted extension; no manual user-gesture validation',
  }
  if (tabStart.err) {
    report.cases.nativeTab.passed = false
    report.cases.nativeTab.probes = await control.evaluate(() => window.probes)
  } else {
    assert.equal(tabStart.res.state, 'recording')
    await new Promise((r) => setTimeout(r, 2000))
    await send('stopRecording')
    const recording = await readRecording(tabStart.res.session.id)
    assert.ok(recording.signal.source440 > 0.02, JSON.stringify(recording.signal))
    report.cases.nativeTab = {
      ...report.cases.nativeTab,
      passed: true,
      ...recording,
      probes: await control.evaluate(() => window.probes),
    }
  }
  report.completed = true
} catch (error) {
  report.error = String(error.stack ?? error)
  process.exitCode = 1
} finally {
  await context?.close()
  await new Promise((r) => server.close(r))
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
