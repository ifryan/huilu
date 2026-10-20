// Built-extension UI + native File System Access + OPFS. Only isolated fixture data.
/* global chrome */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'output/playwright', `U-59-${Date.now()}`)
const ext = resolve(out, 'extension'),
  folder = resolve(out, 'authorized-fixtures')
await mkdir(folder, { recursive: true })
await cp(resolve(root, 'apps/extension/.output/chrome-mv3'), ext, { recursive: true })
await writeFile(
  resolve(ext, 'u59-harness.html'),
  '<!doctype html><title>U59 isolated folder authorization</title><button>Authorize fixture directory</button>',
)
const wav = new Uint8Array(44 + 32000),
  view = new DataView(wav.buffer)
const text = (offset, value) =>
  [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
text(0, 'RIFF')
view.setUint32(4, wav.length - 8, true)
text(8, 'WAVEfmt ')
view.setUint32(16, 16, true)
view.setUint16(20, 1, true)
view.setUint16(22, 1, true)
view.setUint32(24, 16000, true)
view.setUint32(28, 32000, true)
view.setUint16(32, 2, true)
view.setUint16(34, 16, true)
text(36, 'data')
view.setUint32(40, 32000, true)
for (let i = 0; i < 16000; i++)
  view.setInt16(44 + i * 2, Math.sin((i * 2 * Math.PI * 440) / 16000) * 6000, true)
const meeting = (id, title, status = 'ready') => ({
  schemaVersion: 1,
  id,
  title,
  createdAt: '2026-10-20T11:00:00Z',
  durationMs: 1000,
  mode: 'audio',
  language: 'en',
  status,
  speakers: [{ id: '0', name: 'Fixture speaker' }],
  markers: [{ id: 'mark', atMs: 200 }],
  favorite: true,
  media: { audio: { mimeType: 'audio/wav' } },
  providers: {},
  futureField: 'retain',
})
const transcript = {
  language: 'en',
  segments: [{ startMs: 0, endMs: 1000, speakerId: '0', text: 'Isolated fixture transcript.' }],
}
const summary = {
  overview: 'Fixture notes',
  keywords: ['fixture'],
  chapters: [],
  keyPoints: [],
  actionItems: [],
  speakerSummaries: [],
}
const final = {
  ...meeting('u59-folder', 'Folder fixture'),
  mode: 'video',
  media: { audio: { mimeType: 'audio/wav' }, video: { mimeType: 'video/mp4' } },
}
execFileSync('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=blue:s=320x180:r=15',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:sample_rate=16000',
  '-t',
  '1',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-shortest',
  resolve(out, 'fixture.mp4'),
])
const video = await readFile(resolve(out, 'fixture.mp4'))
await mkdir(resolve(folder, 'original-directory'), { recursive: true })
for (const [name, value] of Object.entries({
  'meeting.json': JSON.stringify(final),
  'transcript.json': JSON.stringify(transcript),
  'summary.json': JSON.stringify(summary),
  'audio.webm': wav,
  'video.mp4': video,
}))
  await writeFile(resolve(folder, 'original-directory', name), value)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const originalHashes = Object.fromEntries(
  await Promise.all(
    ['audio.webm', 'video.mp4', 'transcript.json', 'summary.json'].map(async (f) => [
      f,
      hash(await readFile(resolve(folder, 'original-directory', f))),
    ]),
  ),
)
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const xvfb = spawn(
  process.env.XVFB_PATH,
  ['-displayfd', '3', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
)
let context, wm
const report = {
  productCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  cases: [],
  errors: [],
  limitations:
    'Generated fixture media and metadata, isolated Linux Chrome/X11 profile; native folder chooser for success path; permission/write/concurrency failures explicitly injected. No private meeting, physical microphone, system audio, real ASR or cross-platform validation.',
}
try {
  const display =
    ':' +
    (await new Promise((r, j) => {
      xvfb.stdio[3].once('data', (d) => r(String(d).trim()))
      xvfb.once('error', j)
    }))
  const env = {
    ...process.env,
    DISPLAY: display,
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-u59-bus',
    GTK_USE_PORTAL: '0',
  }
  wm = spawn('xfwm4', ['--compositor=off'], {
    env: { ...process.env, DISPLAY: display },
    stdio: 'ignore',
  })
  await pause(600)
  context = await chromium.launchPersistentContext(resolve(out, 'profile'), {
    executablePath: process.env.CHROMIUM_PATH,
    env,
    headless: false,
    viewport: { width: 1280, height: 850 },
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  context.setDefaultTimeout(12000)
  report.browser = context.browser()?.version()
  const base = 'chrome-extension://fddknloecifbbeomieckhnegffdobgni/'
  const harness = await context.newPage()
  await harness.goto(base + 'u59-harness.html')
  await harness.evaluate(() => {
    window.idb = async (dbName, store, mode, fn) => {
      const db = await new Promise((r, j) => {
        const q = indexedDB.open(dbName, 1)
        q.onupgradeneeded = () =>
          q.result.createObjectStore(store, store === 'jobs' ? { keyPath: 'meetingId' } : undefined)
        q.onsuccess = () => r(q.result)
        q.onerror = () => j(q.error)
      })
      try {
        return await new Promise((r, j) => {
          const tx = db.transaction(store, mode),
            q = fn(tx.objectStore(store))
          tx.oncomplete = () => r(q.result)
          tx.onerror = () => j(tx.error)
        })
      } finally {
        db.close()
      }
    }
    document.querySelector('button').onclick = async () => {
      try {
        window.fixtureRoot = await showDirectoryPicker({ mode: 'readwrite' })
        await window.idb('huilu-handles', 'handles', 'readwrite', (s) =>
          s.put(window.fixtureRoot, 'dataFolder'),
        )
        window.authorized = true
      } catch (e) {
        window.pickError = String(e)
      }
    }
  })
  const desktop = (name) =>
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'x11grab',
        '-video_size',
        '1440x1000',
        '-i',
        display,
        '-frames:v',
        '1',
        resolve(out, name + '.png'),
      ],
      { env, stdio: 'ignore' },
    )
  await harness.evaluate(() => chrome.storage.local.set({ onboarded: true, locale: 'en' }))
  await pause(700)
  for (const p of context.pages()) if (p !== harness) await p.close()
  await harness.bringToFront()
  await harness.getByRole('button').click()
  await pause(900)
  const pickerId = execFileSync(
    'xdotool',
    ['search', '--onlyvisible', '--name', 'Select where this site can save changes'],
    { env, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .at(-1)
  execFileSync('xdotool', ['windowactivate', '--sync', pickerId], { env })
  desktop('folder-chooser')
  await pause(300)
  execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+l'], { env })
  await pause(300)
  execFileSync('xdotool', ['type', '--clearmodifiers', folder], { env })
  desktop('folder-path-input')
  const geometry = execFileSync('xdotool', ['getwindowgeometry', '--shell', pickerId], {
    env,
    encoding: 'utf8',
  })
  const width = Number(geometry.match(/WIDTH=(\d+)/)[1]),
    height = Number(geometry.match(/HEIGHT=(\d+)/)[1])
  execFileSync(
    'xdotool',
    ['mousemove', '--window', pickerId, String(width - 50), String(height - 24), 'click', '1'],
    { env },
  )
  await pause(700)
  desktop('folder-path-selected')
  report.firstSelection = await harness.evaluate(() => ({
    error: window.pickError,
    authorized: window.authorized,
    name: window.fixtureRoot?.name,
  }))
  await pause(600)
  // Chrome's final "Allow site to edit files" prompt, if shown.
  if (!(await harness.evaluate(() => window.authorized))) {
    desktop('authorization-prompt')
    report.authText = execFileSync(
      'tesseract',
      [resolve(out, 'authorization-prompt.png'), 'stdout'],
      { encoding: 'utf8' },
    )
    report.authWindow = execFileSync('xwininfo', ['-root', '-tree'], { env, encoding: 'utf8' })
    report.authState = await harness.evaluate(() => ({
      error: window.pickError,
      authorized: window.authorized,
    }))
    execFileSync('xdotool', ['key', 'Tab'], { env })
    execFileSync('xdotool', ['key', 'Return'], { env })
  }
  await harness.waitForFunction(() => window.authorized === true)
  report.cases.push({
    name: 'native-folder-authorization',
    permission: await harness.evaluate(() =>
      window.fixtureRoot.queryPermission({ mode: 'readwrite' }),
    ),
  })
  await harness.evaluate(
    async ({ wav, video, final, transcript, summary }) => {
      await chrome.storage.local.set({
        onboarded: true,
        locale: 'en',
        transcription: {
          providerId: 'openai-compatible',
          configs: {
            'openai-compatible': {
              preset: 'custom',
              baseUrl: 'http://127.0.0.1:1/v1',
              model: 'fixture',
              apiKey: 'unused-fixture',
            },
          },
        },
      })
      window.recordings = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('recordings', { create: true })
      window.readJson = async (dir, name) =>
        JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text())
      window.write = async (dir, name, data) => {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
        await w.write(data)
        await w.close()
      }
      for (const [id, title, state, status] of [
        ['u59-local', 'Local fixture', 'stopped', 'failed'],
        ['u59-folder', 'Old manifest title', 'stopped', 'ready'],
        ['u59-unfinished', 'Interrupted fixture', 'recording', 'recording'],
      ]) {
        const dir = await window.recordings.getDirectoryHandle(id, { create: true })
        await window.write(
          dir,
          'manifest.json',
          JSON.stringify({
            version: 1,
            id,
            title,
            mode: id === 'u59-folder' ? 'video' : 'audio',
            videoSource: 'tab',
            language: 'en',
            microphone: false,
            state,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            activeMs: 1000,
            endReason: state === 'stopped' ? 'error' : undefined,
            error: state === 'stopped' ? 'Fixture partial recording' : undefined,
            tracks: {
              audio: { mimeType: 'audio/wav', chunks: 1, bytes: wav.length, sizes: [wav.length] },
              ...(id === 'u59-folder'
                ? {
                    video: {
                      mimeType: 'video/mp4',
                      chunks: 1,
                      bytes: video.length,
                      sizes: [video.length],
                    },
                  }
                : {}),
            },
          }),
        )
        await window.write(
          dir,
          'meeting.json',
          JSON.stringify({
            ...final,
            mode: id === 'u59-folder' ? 'video' : 'audio',
            media: id === 'u59-folder' ? final.media : { audio: final.media.audio },
            id,
            title: id === 'u59-folder' ? 'Old retained OPFS title' : title,
            status,
          }),
        )
        const audio = await dir.getDirectoryHandle('audio', { create: true })
        await window.write(audio, '000001.part', new Uint8Array(wav))
        if (id === 'u59-folder')
          await window.write(
            await dir.getDirectoryHandle('video', { create: true }),
            '000001.part',
            new Uint8Array(video),
          )
        await window.write(dir, 'transcript.json', JSON.stringify(transcript))
        await window.write(dir, 'summary.json', JSON.stringify(summary))
        if (id !== 'u59-unfinished')
          await window.idb('huilu-pipeline', 'jobs', 'readwrite', (s) =>
            s.put({
              meetingId: id,
              state: id === 'u59-folder' ? 'done' : 'failed',
              folderCommitted: id === 'u59-folder',
              folderDir: id === 'u59-folder' ? 'original-directory' : undefined,
              error:
                id === 'u59-local'
                  ? { step: 'transcribe', code: 'unknown', retryable: false }
                  : undefined,
              attempts: 1,
              checkpoints: { fixture: 'keep' },
              createdAt: 1,
              updatedAt: 2,
            }),
          )
      }
    },
    { wav: Array.from(wav), video: Array.from(video), final, transcript, summary },
  )
  const snapshot = () =>
    harness.evaluate(async () => {
      const result = {}
      for (const id of ['u59-local', 'u59-folder']) {
        const dir = await window.recordings.getDirectoryHandle(id),
          files = {}
        for (const name of [
          'manifest.json',
          'transcript.json',
          'summary.json',
          'audio/000001.part',
          ...(id === 'u59-folder' ? ['video/000001.part'] : []),
        ]) {
          let h = dir
          const parts = name.split('/')
          for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p)
          const bytes = await (await (await h.getFileHandle(parts.at(-1))).getFile()).arrayBuffer()
          files[name] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('')
        }
        result[id] = {
          files,
          meeting: await window.readJson(dir, 'meeting.json'),
          job: await window.idb('huilu-pipeline', 'jobs', 'readonly', (s) => s.get(id)),
        }
      }
      return result
    })
  const before = await snapshot()
  const app = await context.newPage()
  app.on('pageerror', (e) => report.errors.push(String(e)))
  const history = async () => {
    await app.goto(base + 'app.html#/')
    await app.getByRole('button', { name: 'Refresh and rebuild list' }).click()
  }
  const row = (title) => app.locator('li').filter({ hasText: title })
  const shot = async (name) => {
    await pause(200)
    await app.screenshot({ path: resolve(out, name + '.png'), fullPage: !name.includes('dialog') })
  }
  await history()
  await row('Folder fixture').waitFor()
  await shot('history-before')
  assert.equal(
    await row('Interrupted fixture')
      .getByRole('button', { name: 'Archive', exact: true })
      .isDisabled(),
    true,
  )
  for (const [oldTitle, newTitle] of [
    ['Folder fixture', 'Folder title edited'],
    ['Local fixture', 'Local title edited'],
  ]) {
    await row(oldTitle).getByRole('button', { name: 'Edit title', exact: true }).click()
    await app.getByRole('dialog').getByLabel('Meeting title').fill('   ')
    await app.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await app.getByRole('alert').filter({ hasText: 'Enter a meeting title' }).waitFor()
    await app.keyboard.press('Escape')
    await row(oldTitle).getByRole('button', { name: 'Edit title', exact: true }).click()
    await app.getByRole('dialog').getByLabel('Meeting title').fill(newTitle)
    await app.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await app.getByRole('dialog').waitFor({ state: 'hidden' })
    await app.reload()
    await row(newTitle).waitFor()
    await app.getByRole('searchbox').fill(newTitle)
    assert.equal(await app.locator('li').count(), 1)
    await app.getByRole('searchbox').fill('')
    await row(newTitle).getByRole('link', { name: 'Open meeting', exact: true }).click()
    assert.equal(await app.getByLabel('Meeting title').inputValue(), newTitle)
    if (oldTitle.startsWith('Folder')) {
      await app.locator('video').waitFor()
      await app.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
      assert.ok(await app.locator('video').evaluate((el) => el.duration >= 1))
    }
    await history()
    await row(newTitle).getByRole('button', { name: 'Archive', exact: true }).click()
    await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(await row(newTitle).count(), 1)
    await row(newTitle).getByRole('button', { name: 'Archive', exact: true }).click()
    await shot(
      oldTitle.startsWith('Folder') ? 'archive-confirmation' : 'local-archive-confirmation',
    )
    await app.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
    await app.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await row(newTitle).count(), 0)
    assert.equal(await app.evaluate(() => document.activeElement.textContent), 'Meetings')
    await app.reload()
    assert.equal(await row(newTitle).count(), 0)
    await app.getByRole('button', { name: 'Archived', exact: true }).click()
    await row(newTitle).waitFor()
    assert.equal(await row(newTitle).getByRole('button', { name: 'Retry', exact: true }).count(), 0)
    await shot(oldTitle.startsWith('Folder') ? 'folder-archived' : 'local-archived')
    await row(newTitle).getByRole('button', { name: 'Restore', exact: true }).click()
    await app.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
    await app.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await app.evaluate(() => document.activeElement.textContent), 'Archived')
    await app.getByRole('button', { name: 'Meetings', exact: true }).click()
    await row(newTitle).waitFor()
    report.cases.push({
      name: 'title-archive-restore',
      source: oldTitle,
      refreshed: true,
      details: true,
      search: true,
      cancel: true,
    })
  }
  await shot('history-after')
  const after = await snapshot()
  for (const id of ['u59-local', 'u59-folder']) {
    assert.deepEqual(after[id].files, before[id].files)
    assert.deepEqual(after[id].job, before[id].job)
  }
  assert.equal(after['u59-local'].meeting.title, 'Local title edited')
  assert.equal(after['u59-local'].meeting.futureField, 'retain')
  assert.equal(after['u59-local'].meeting.archived, false)
  const savedFinal = JSON.parse(
    await readFile(resolve(folder, 'original-directory/meeting.json'), 'utf8'),
  )
  assert.equal(savedFinal.title, 'Folder title edited')
  assert.equal(savedFinal.archived, false)
  assert.equal(savedFinal.futureField, 'retain')
  assert.deepEqual(await readdir(folder), ['original-directory'])
  for (const [name, digest] of Object.entries(originalHashes))
    assert.equal(hash(await readFile(resolve(folder, 'original-directory', name))), digest)
  report.storage = { before, after, final: savedFinal, originalHashes }
  assert.equal(
    await row('Local title edited').getByRole('button', { name: 'Retry', exact: true }).isEnabled(),
    true,
  )
  // Two independently loaded pages compete for the same source field.
  const second = await context.newPage()
  await second.goto(base + 'app.html#/')
  for (const p of [app, second])
    await p
      .locator('li')
      .filter({ hasText: 'Local title edited' })
      .getByRole('button', { name: 'Edit title', exact: true })
      .click()
  await app.getByRole('dialog').getByLabel('Meeting title').fill('Concurrent winner')
  await app.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await app.getByRole('dialog').waitFor({ state: 'hidden' })
  await second.getByRole('dialog').getByLabel('Meeting title').fill('Stale overwrite')
  await second.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
  await second.getByRole('alert').filter({ hasText: 'changed' }).waitFor()
  await second.screenshot({ path: resolve(out, 'conflict.png'), fullPage: true })
  await second.close()
  report.cases.push({ name: 'two-page-conflict', rejected: true })
  // Faults below are explicitly injected, success tests above use original prototypes.
  await app.evaluate(() => {
    window.originalCreateWritable = FileSystemFileHandle.prototype.createWritable
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (window.failMetadata && this.name === 'meeting.json')
        throw new DOMException('Injected disk full', 'QuotaExceededError')
      return window.originalCreateWritable.apply(this, args)
    }
    window.failMetadata = true
  })
  await row('Concurrent winner').getByRole('button', { name: 'Archive', exact: true }).click()
  await app.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
  await app.getByRole('alert').filter({ hasText: 'Could not confirm' }).waitFor()
  await shot('write-failure')
  assert.equal((await snapshot())['u59-local'].meeting.archived, false)
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = window.originalCreateWritable
  })
  report.cases.push({ name: 'injected-write-failure', metadataUnchanged: true })
  await row('Folder title edited').getByRole('button', { name: 'Archive', exact: true }).click()
  await app.evaluate(() => {
    window.originalQueryPermission = FileSystemDirectoryHandle.prototype.queryPermission
    FileSystemDirectoryHandle.prototype.queryPermission = async () => 'denied'
  })
  await app.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
  await app.getByRole('alert').filter({ hasText: 'Could not confirm' }).waitFor()
  await shot('permission-failure')
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.evaluate(() => {
    FileSystemDirectoryHandle.prototype.queryPermission = window.originalQueryPermission
  })
  report.cases.push({ name: 'injected-permission-withdrawn', rejected: true })
  await row('Concurrent winner').getByRole('button', { name: 'Archive', exact: true }).click()
  await harness.evaluate(async () => {
    const j = await window.idb('huilu-pipeline', 'jobs', 'readonly', (s) => s.get('u59-local'))
    window.savedJob = j
    await window.idb('huilu-pipeline', 'jobs', 'readwrite', (s) =>
      s.put({ ...j, state: 'running' }),
    )
  })
  await app.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()
  await app.getByRole('alert').filter({ hasText: 'pending processing' }).waitFor()
  await shot('busy-conflict')
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await harness.evaluate(async () =>
    window.idb('huilu-pipeline', 'jobs', 'readwrite', (s) => s.put(window.savedJob)),
  )
  report.cases.push({ name: 'injected-processing-start-after-dialog', rejected: true })
  await harness.evaluate(() => chrome.storage.local.set({ locale: 'zh-CN' }))
  await app.setViewportSize({ width: 390, height: 844 })
  await app.getByRole('button', { name: '编辑标题', exact: true }).first().waitFor()
  await shot('mobile-zh')
  await row('Concurrent winner').getByRole('button', { name: '编辑标题', exact: true }).click()
  await shot('mobile-zh-dialog')
  assert.equal(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(
    await app.getByRole('dialog').evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    true,
  )
  await app.keyboard.press('Tab')
  assert.equal(
    await app.getByRole('dialog').evaluate((el) => el.contains(document.activeElement)),
    true,
  )
  await app.keyboard.press('Shift+Tab')
  assert.equal(
    await app.getByRole('dialog').evaluate((el) => el.contains(document.activeElement)),
    true,
  )
  await app.keyboard.press('Escape')
  assert.equal(await app.getByRole('dialog').count(), 0)
  assert.equal(await app.evaluate(() => document.activeElement.textContent), '编辑标题')
  await app.getByRole('status').filter({ hasText: '会议标题已保存。' }).waitFor()
  report.cases.push({ name: 'chinese-mobile-keyboard', width: 390, noOverflow: true, escape: true })
  report.passed = true
} catch (e) {
  report.error = String(e.stack || e)
  if (context) {
    const p = context.pages().at(-1)
    report.failurePage = await p.evaluate(() => document.body.innerText).catch(() => 'closed')
    await p.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  if (context) await context.close()
  for (const child of [wm, xvfb])
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((r) => child.once('exit', r))
      child.kill('SIGTERM')
      await closed
    }
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
