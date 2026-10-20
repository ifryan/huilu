// Run after pnpm build. Requires Playwright Core and its Chromium installation.
// PLAYWRIGHT_MODULE may point at an existing playwright-core/index.mjs.
/* global chrome */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'output/playwright', `U-64-${Date.now()}`)
await mkdir(out, { recursive: true })
const ext = resolve(out, 'extension')
await cp(resolve(root, 'apps/extension/.output/chrome-mv3'), ext, { recursive: true })
const viteDir = (await readdir(resolve(root, 'node_modules/.pnpm'))).find((x) =>
  x.startsWith('vite@'),
)
const require = createRequire(
  resolve(root, 'node_modules/.pnpm', viteDir, 'node_modules/vite/package.json'),
)
const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')))
const bundle = await rolldown({ input: resolve(root, 'scripts/u64-browser-fixture.ts') })
await bundle.write({ file: resolve(ext, 'u64-fixture.js'), format: 'es' })
await bundle.close()
await writeFile(
  resolve(ext, 'u64-harness.html'),
  '<!doctype html><title>U-64 browser verification</title>',
)

let providerCalls = 0
const server = createServer((_req, res) => {
  if (_req.method === 'POST') providerCalls++
  res.setHeader('Content-Type', 'text/html')
  res.end(
    '<!doctype html><title>U64 source 440Hz</title><button onclick="window.ctx=new AudioContext();let o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=440;g.gain.value=.15;o.connect(g).connect(ctx.destination);o.start()">Play 440 Hz tab audio</button>',
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}`
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : 'playwright-core'
)
const id = 'fddknloecifbbeomieckhnegffdobgni'
let context
const report = {
  source: process.env.REAL_TAB_CAPTURE
    ? 'Real chrome.tabCapture stream, 440 Hz localhost tab'
    : 'Synthetic 440 Hz MediaStream at getUserMedia boundary; real Web Audio mixing and Opus recording',
  microphone: 'Synthetic 880 Hz MediaStream at microphone getUserMedia boundary; no physical mic',
  authorization:
    'allowlisted-extension-id bypasses the interactive activeTab grant in this test profile',
  nativePicker:
    'Not exercised; desktop no-audio path covered by unit tests and supplied screenshot',
  cases: {},
}
try {
  context = await chromium.launchPersistentContext(resolve(out, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH,
    headless: false,
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
  report.browser = context.browser()?.version()
  const page = await context.newPage()
  await page.goto(`chrome-extension://${id}/u64-harness.html`)
  await page.evaluate(async () => {
    window.fixture = await import('./u64-fixture.js')
  })
  const source = await context.newPage()
  await source.goto(url)
  await source.getByRole('button').click()
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  for (const [name, sourceAudio, microphone] of [
    ['both', true, true],
    ['source-only', true, false],
    ['mic-only', false, true],
  ]) {
    const streamId = process.env.REAL_TAB_CAPTURE
      ? await worker.evaluate(
          async ({ url }) => {
            const tabs = await chrome.tabs.query({})
            return chrome.tabCapture.getMediaStreamId({
              targetTabId: tabs.find((t) => t.url?.startsWith(url)).id,
            })
          },
          { url, id },
        )
      : 'synthetic-source'
    report.cases[name] = await page.evaluate(
      async ({ streamId, sourceAudio, microphone }) => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          if (streamId === 'synthetic-source' || !constraints.audio?.mandatory) {
            const ctx = new AudioContext(),
              osc = ctx.createOscillator(),
              gain = ctx.createGain()
            const destination = ctx.createMediaStreamDestination()
            osc.frequency.value =
              constraints.audio?.mandatory || constraints.video?.mandatory ? 440 : 880
            gain.gain.value = 0.2
            osc.connect(gain).connect(destination)
            osc.start()
            window.testContexts ??= []
            window.testContexts.push(ctx)
            return destination.stream
          }
          try {
            return await original(constraints)
          } catch (e) {
            throw new Error(`${e.name}: ${e.message}; constraints=${JSON.stringify(constraints)}`, {
              cause: e,
            })
          }
        }
        const media = await window.fixture.browserMediaBackend.capture({
          streamId,
          sourceAudio,
          sourceAudioRequested: sourceAudio,
          source: 'tab',
          mode: 'audio',
          quality: { resolution: '720p', fps: 15 },
          microphone: { enabled: microphone },
        })
        try {
          const recorder = new MediaRecorder(new MediaStream([media.transcriptAudioTrack]), {
            mimeType: 'audio/webm;codecs=opus',
          })
          const chunks = []
          recorder.ondataavailable = (e) => chunks.push(e.data)
          const stopped = new Promise((r) => {
            recorder.onstop = r
          })
          recorder.start()
          await new Promise((r) => setTimeout(r, 2000))
          recorder.stop()
          await stopped
          const blob = new Blob(chunks, { type: recorder.mimeType })
          const ctx = new AudioContext()
          try {
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
            const values = decoded.getChannelData(0)
            const from = Math.round(decoded.sampleRate * 0.5)
            const n = Math.min(Math.round(decoded.sampleRate), values.length - from)
            const amplitude = (frequency) => {
              let re = 0,
                im = 0
              for (let i = 0; i < n; i++) {
                const angle = (2 * Math.PI * frequency * i) / decoded.sampleRate
                re += values[from + i] * Math.cos(angle)
                im += values[from + i] * Math.sin(angle)
              }
              return (2 * Math.hypot(re, im)) / n
            }
            return {
              bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
              channels: decoded.numberOfChannels,
              source440: amplitude(440),
              mic880: amplitude(880),
              warnings: media.warnings,
              hasSignal: await window.fixture.audioHasSignal(blob, new AbortController().signal),
            }
          } finally {
            await ctx.close()
          }
        } finally {
          media.stop()
          for (const ctx of window.testContexts ?? []) await ctx.close()
          window.testContexts = []
          navigator.mediaDevices.getUserMedia = original
        }
      },
      { streamId, sourceAudio, microphone },
    )
    const result = report.cases[name]
    await writeFile(resolve(out, `${name}.webm`), Buffer.from(result.bytes))
    delete result.bytes
    assert.equal(result.channels, 1)
    assert.equal(result.hasSignal, true)
    assert.deepEqual(result.warnings, [])
    if (sourceAudio) assert.ok(result.source440 > 0.02, JSON.stringify(result))
    else assert.ok(result.source440 < 0.002, JSON.stringify(result))
    if (microphone) assert.ok(result.mic880 > 0.02, JSON.stringify(result))
    else assert.ok(result.mic880 < 0.002, JSON.stringify(result))
  }

  report.cases.inspection = await page.evaluate(async () => {
    const results = {}
    // Exercise real Opus encoding and WebCodecs decoding, including a late signal.
    for (const [name, amplitude, delay, channels] of [
      ['digital-silence', 0, 0, 1],
      ['quiet-signal', 0.0001, 0, 1],
      ['late-right-channel-signal', 0.1, 0.7, 2],
    ]) {
      const ctx = new AudioContext()
      const destination = ctx.createMediaStreamDestination()
      destination.channelCount = channels
      const osc = ctx.createOscillator(),
        gain = ctx.createGain()
      gain.gain.value = 0
      gain.gain.setValueAtTime(amplitude, ctx.currentTime + delay)
      osc.connect(gain)
      if (channels === 2) {
        const merger = ctx.createChannelMerger(2)
        gain.connect(merger, 0, 1)
        merger.connect(destination)
      } else gain.connect(destination)
      osc.start()
      const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      const stopped = new Promise((r) => {
        recorder.onstop = r
      })
      recorder.start()
      await new Promise((r) => setTimeout(r, 1300))
      recorder.stop()
      await stopped
      const blob = new Blob(chunks, { type: recorder.mimeType })
      if (name === 'digital-silence') window.silentBlob = blob
      results[name] = await window.fixture.audioHasSignal(blob, new AbortController().signal)
      osc.stop()
      destination.stream.getTracks().forEach((t) => t.stop())
      await ctx.close()
    }
    try {
      await window.fixture.audioHasSignal(new Blob(['not audio']), new AbortController().signal)
      results.corrupt = 'unexpected success'
    } catch {
      results.corrupt = 'rejected'
    }
    const abort = new AbortController()
    abort.abort()
    try {
      await window.fixture.audioHasSignal(new Blob(['unused']), abort.signal)
      results.aborted = 'unexpected success'
    } catch (e) {
      results.aborted = e.name
    }
    return results
  })
  assert.deepEqual(report.cases.inspection, {
    'digital-silence': false,
    'quiet-signal': true,
    'late-right-channel-signal': true,
    corrupt: 'rejected',
    aborted: 'AbortError',
  })
  // Exercise the shipped offscreen queue, OPFS storage and real history UI.
  // Only generated silence is inserted into this isolated browser profile.
  const meetingId = '20261020-180000-0000ab64'
  await page.evaluate(
    async ({ meetingId, url }) => {
      await chrome.storage.local.set({
        onboarded: true,
        locale: 'en',
        transcription: {
          providerId: 'openai-compatible',
          configs: {
            'openai-compatible': { preset: 'custom', baseUrl: `${url}/v1`, model: 'test-only' },
          },
        },
      })
      const recordings = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('recordings', { create: true })
      const dir = await recordings.getDirectoryHandle(meetingId, { create: true })
      const write = async (dir, name, content) => {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
        await w.write(content)
        await w.close()
      }
      const blob = window.silentBlob
      await write(await dir.getDirectoryHandle('audio', { create: true }), '000001.part', blob)
      await write(
        dir,
        'manifest.json',
        JSON.stringify({
          version: 1,
          id: meetingId,
          title: 'U-64 digital silence test',
          mode: 'audio',
          videoSource: 'tab',
          language: 'en',
          microphone: false,
          state: 'stopped',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          activeMs: 1300,
          endReason: 'user',
          tracks: {
            audio: { mimeType: blob.type, chunks: 1, bytes: blob.size, sizes: [blob.size] },
          },
        }),
      )
      await write(
        dir,
        'meeting.json',
        JSON.stringify({
          schemaVersion: 1,
          id: meetingId,
          title: 'U-64 digital silence test',
          createdAt: new Date().toISOString(),
          durationMs: 1300,
          mode: 'audio',
          language: 'en',
          status: 'processing',
          media: { audio: { mimeType: blob.type } },
          speakers: [],
          markers: [],
          providers: {},
        }),
      )
      await new Promise((resolve, reject) =>
        chrome.runtime.sendMessage(
          {
            id: Date.now(),
            type: 'processMeeting',
            data: meetingId,
            timestamp: Date.now(),
          },
          (response) =>
            chrome.runtime.lastError || response?.err
              ? reject(new Error(JSON.stringify(response?.err ?? chrome.runtime.lastError)))
              : resolve(response),
        ),
      )
    },
    { meetingId, url },
  )
  const app = await context.newPage()
  await app.goto(`chrome-extension://${id}/app.html#/`)
  await app.waitForFunction(
    () => document.body.innerText.includes('The recording is entirely silent'),
    { timeout: 15000 },
  )
  await app.screenshot({ path: resolve(out, 'silent-history.png'), fullPage: true })
  report.cases.shippedQueue = await page.evaluate(async (meetingId) => {
    const root = await navigator.storage.getDirectory()
    const dir = await (await root.getDirectoryHandle('recordings')).getDirectoryHandle(meetingId)
    const meeting = JSON.parse(
      await (await (await dir.getFileHandle('meeting.json')).getFile()).text(),
    )
    const audio = await (
      await (await dir.getDirectoryHandle('audio')).getFileHandle('000001.part')
    ).getFile()
    const job = await new Promise((resolve, reject) => {
      const r = indexedDB.open('huilu-pipeline')
      r.onsuccess = () => {
        const d = r.result,
          t = d.transaction('jobs'),
          q = t.objectStore('jobs').get(meetingId)
        t.oncomplete = () => {
          resolve(q.result)
          d.close()
        }
        t.onerror = () => reject(t.error)
      }
      r.onerror = () => reject(r.error)
    })
    return {
      meetingStatus: meeting.status,
      keptAudioBytes: audio.size,
      state: job.state,
      error: job.error,
    }
  }, meetingId)
  report.cases.shippedQueue.providerCalls = providerCalls
  assert.equal(report.cases.shippedQueue.state, 'failed')
  assert.equal(report.cases.shippedQueue.error.code, 'silentAudio')
  assert.equal(report.cases.shippedQueue.providerCalls, 0)
  assert.ok(report.cases.shippedQueue.keptAudioBytes > 0)
  await app.evaluate(() => chrome.storage.local.set({ locale: 'zh-CN' }))
  await app.reload()
  await app.waitForFunction(() => document.body.innerText.includes('录音全程静音'))
  await app.screenshot({ path: resolve(out, 'silent-history-zh.png'), fullPage: true })
  report.passed = true
} catch (error) {
  report.error = String(error.stack ?? error)
  process.exitCode = 1
} finally {
  await context?.close()
  await new Promise((r) => server.close(r))
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
