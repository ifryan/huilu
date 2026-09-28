import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
const output = resolve(process.env.U35_OUTPUT_DIR ?? 'output/playwright/u35')
await mkdir(output, { recursive: true })
process.chdir(output)
const previous = JSON.parse(await readFile('browser-output/results.json', 'utf8'))
const profile = previous.profile
assert.ok(
  profile.startsWith(resolve('browser-output') + sep),
  'Only the synthetic profile under the artifact directory is allowed',
)
const extension = fileURLToPath(new URL('../../apps/extension/.output/chrome-mv3', import.meta.url))
const base = 'chrome-extension://fddknloecifbbeomieckhnegffdobgni/app.html#'
const launch = () =>
  chromium.launchPersistentContext(profile, {
    executablePath: process.env.U35_CHROMIUM_PATH ?? chromium.executablePath(),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      '--disable-background-networking',
    ],
  })
let ctx = await launch()
const results = []
const errors = []
const requests = []
const record = (s) => {
  results.push(s)
  console.log(s)
}
const observe = () => {
  ctx.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url())
  })
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
}
observe()
try {
  const page = await ctx.newPage()
  await page.goto(base + '/')
  await page.evaluate(async () => {
    await chrome.storage.local.set({ locale: 'en', onboarded: true })
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase('huilu-result-notifications')
      r.onsuccess = resolve
      r.onerror = reject
    })
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle('test-library')
    const original = await folder.getDirectoryHandle('2026-09-28_fixture')
    const raw = JSON.parse(
      await (await (await original.getFileHandle('meeting.json')).getFile()).text(),
    )
    const audio = await (await original.getFileHandle('audio.webm')).getFile()
    const recordings = await root.getDirectoryHandle('recordings', { create: true })
    const dir = await recordings.getDirectoryHandle('legacy', { create: true })
    const track = await dir.getDirectoryHandle('audio', { create: true })
    const write = async (d, n, v) => {
      const f = await d.getFileHandle(n, { create: true })
      const w = await f.createWritable()
      await w.write(v)
      await w.close()
    }
    await write(track, '000001.part', audio)
    await write(
      dir,
      'meeting.json',
      JSON.stringify({
        ...raw,
        id: 'legacy',
        title: 'Legacy audio fixture',
        mode: 'audio',
        status: 'processing',
        media: { audio: { mimeType: 'audio/webm;codecs=opus' } },
      }),
    )
    await write(
      dir,
      'manifest.json',
      JSON.stringify({
        version: 1,
        id: 'legacy',
        title: 'Legacy audio fixture',
        mode: 'audio',
        videoSource: 'tab',
        language: 'en',
        microphone: false,
        state: 'stopped',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        activeMs: 12000,
        tracks: {
          audio: {
            mimeType: 'audio/webm;codecs=opus',
            chunks: 1,
            bytes: audio.size,
            sizes: [audio.size],
          },
        },
        endReason: 'user',
      }),
    )
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('huilu-pipeline', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('jobs', { keyPath: 'meetingId' })
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('jobs', 'readwrite')
        tx.objectStore('jobs').put({
          meetingId: 'fixture',
          state: 'done',
          attempts: 1,
          folderDir: '2026-09-28_fixture',
          folderCommitted: true,
          checkpoints: {},
          createdAt: 1,
          updatedAt: 2,
          finishedAt: 2,
          summary: { state: 'done' },
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = reject
      }
    })
  })
  await page.reload()
  await page.getByRole('link', { name: 'Legacy audio fixture', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Legacy audio fixture', exact: true }).click()
  await page.locator('audio').waitFor({ state: 'attached' })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  record('Original OPFS recording remains playable without API settings')
  await page.goto(base + '/')
  const before = ctx.pages().length
  const opened = ctx.waitForEvent('page')
  await page.evaluate(() =>
    Promise.all(
      Array.from({ length: 5 }, (_, id) =>
        chrome.runtime.sendMessage({
          id,
          type: 'processingCompleted',
          timestamp: Date.now(),
          data: 'fixture',
        }),
      ),
    ),
  )
  const resultPage = await opened
  await resultPage.waitForURL(base + '/meeting/fixture')
  assert.equal(ctx.pages().length, before + 1)
  await resultPage.close()
  await page.evaluate(() =>
    chrome.runtime.sendMessage({
      id: 10,
      type: 'processingCompleted',
      timestamp: Date.now(),
      data: 'fixture',
    }),
  )
  assert.equal(ctx.pages().length, before)
  record('Five concurrent completion notifications open one result; replay opens none')
  await ctx.close()
  ctx = await launch()
  observe()
  const p = await ctx.newPage()
  await p.goto(base + '/')
  const restartCount = ctx.pages().length
  await p.evaluate(() =>
    chrome.runtime.sendMessage({
      id: 11,
      type: 'processingCompleted',
      timestamp: Date.now(),
      data: 'fixture',
    }),
  )
  assert.equal(ctx.pages().length, restartCount)
  record('Completed history does not reopen results after browser restart')
  await p.goto(base + '/meeting/fixture')
  await p.getByRole('textbox', { name: 'Meeting title', exact: true }).waitFor()
  const p2 = await ctx.newPage()
  await p2.goto(base + '/meeting/fixture')
  await p2.getByRole('textbox', { name: 'Meeting title', exact: true }).waitFor()
  await Promise.all([
    p.getByRole('textbox', { name: 'Meeting title', exact: true }).fill('Concurrent A'),
    p2.getByRole('textbox', { name: 'Meeting title', exact: true }).fill('Concurrent B'),
  ])
  await Promise.all([
    p.getByRole('textbox', { name: 'Meeting title', exact: true }).press('Enter'),
    p2.getByRole('textbox', { name: 'Meeting title', exact: true }).press('Enter'),
  ])
  await Promise.race([
    p
      .getByText('Changed in another page. Refresh before editing again.', { exact: true })
      .waitFor(),
    p2
      .getByText('Changed in another page. Refresh before editing again.', { exact: true })
      .waitFor(),
  ])
  record('Concurrent stale title edit reports a conflict instead of overwriting')
  await p2.close()
  await p.reload()
  await p.getByRole('textbox', { name: 'Meeting title', exact: true }).waitFor()
  await p
    .getByRole('textbox', { name: 'Meeting title', exact: true })
    .fill('Edited synthetic meeting')
  await p.getByRole('textbox', { name: 'Meeting title', exact: true }).press('Enter')
  await p.getByText('All changes saved', { exact: true }).waitFor()
  await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const other = await root.getDirectoryHandle('another-library', { create: true })
    const dir = await other.getDirectoryHandle('2026-09-28_fixture', { create: true })
    const original = await (
      await root.getDirectoryHandle('test-library')
    ).getDirectoryHandle('2026-09-28_fixture')
    const m = JSON.parse(
      await (await (await original.getFileHandle('meeting.json')).getFile()).text(),
    )
    m.title = 'Other folder must stay unchanged'
    const h = await dir.getFileHandle('meeting.json', { create: true })
    const w = await h.createWritable()
    await w.write(JSON.stringify(m))
    await w.close()
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('huilu-handles', 1)
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('handles', 'readwrite')
        tx.objectStore('handles').put(other, 'dataFolder')
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = reject
      }
    })
  })
  await p
    .getByRole('textbox', { name: 'Meeting title', exact: true })
    .fill('Must not cross folders')
  await p.getByRole('textbox', { name: 'Meeting title', exact: true }).press('Enter')
  await p.getByText('Could not save. Check folder access and try again.', { exact: true }).waitFor()
  const otherTitle = await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    return JSON.parse(
      await (
        await (
          await (
            await (
              await root.getDirectoryHandle('another-library')
            ).getDirectoryHandle('2026-09-28_fixture')
          ).getFileHandle('meeting.json')
        ).getFile()
      ).text(),
    ).title
  })
  assert.equal(otherTitle, 'Other folder must stay unchanged')
  await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const original = await root.getDirectoryHandle('test-library')
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('huilu-handles', 1)
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('handles', 'readwrite')
        tx.objectStore('handles').put(original, 'dataFolder')
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = reject
      }
    })
  })
  record('Changing selected root cannot redirect a stale page edit')
  await p.goto(base + '/')
  await p.getByRole('link', { name: 'Edited synthetic meeting', exact: true }).waitFor()
  await p.evaluate(() => {
    window.originalPermission = FileSystemDirectoryHandle.prototype.queryPermission
    FileSystemDirectoryHandle.prototype.queryPermission = async () => 'denied'
  })
  await p.getByRole('button', { name: 'Refresh and rebuild list' }).click()
  await p.getByText(/The data folder is unavailable/).waitFor()
  assert.equal(
    await p.getByRole('link', { name: 'Edited synthetic meeting', exact: true }).count(),
    0,
  )
  await p.getByRole('heading', { name: 'Edited synthetic meeting', exact: true }).waitFor()
  assert.equal(await p.getByRole('link', { name: 'Legacy audio fixture', exact: true }).count(), 1)
  await p.goto(base + '/meeting/fixture')
  await p.getByRole('heading', { name: 'This meeting is unavailable', exact: true }).waitFor()
  await p.evaluate(() => {
    FileSystemDirectoryHandle.prototype.queryPermission = window.originalPermission
  })
  record(
    'Simulated permission revocation retains cached history and blocks stale final-data fallback',
  )
  await p.goto(base + '/meeting/fixture')
  await p.reload()
  await p.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
  await p.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await p.getByRole('button', { name: /00:00:04 Prototype review/ }).click()
  await p.waitForFunction(() => document.querySelector('video')?.currentTime >= 4)
  await p.getByRole('button', { name: 'Pause', exact: true }).click()
  await p.screenshot({ path: 'browser-output/result-en.png', fullPage: true })
  await p.evaluate(() => chrome.storage.local.set({ locale: 'zh-CN' }))
  await p.getByRole('heading', { name: '逐字稿', exact: true }).waitFor()
  await p.screenshot({ path: 'browser-output/result-zh.png', fullPage: true })
  await p.setViewportSize({ width: 390, height: 844 })
  await p.screenshot({ path: 'browser-output/result-mobile.png', fullPage: true })
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  record('English/Chinese pages render; 390px viewport has no horizontal overflow')
  assert.equal(requests.length, 0, JSON.stringify(requests))
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ results, requests, errors }, null, 2))
  await writeFile(
    'browser-output/edges.json',
    JSON.stringify({ results, requests, errors }, null, 2),
  )
} catch (e) {
  console.error(e)
  const p = ctx.pages().at(-1)
  if (p) {
    await p.screenshot({ path: 'browser-output/edges-failure.png', fullPage: true }).catch(() => {})
    console.error((await p.locator('body').innerText()).slice(0, 8000))
  }
  process.exitCode = 1
} finally {
  await ctx.close()
}
