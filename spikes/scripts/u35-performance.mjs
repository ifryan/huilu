import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
const output = resolve(process.env.U35_OUTPUT_DIR ?? 'output/playwright/u35')
const { profile } = JSON.parse(
  await readFile(resolve(output, 'browser-output/results.json'), 'utf8'),
)
assert.ok(profile.startsWith(resolve(output, 'browser-output') + sep))
const extension = fileURLToPath(new URL('../../apps/extension/.output/chrome-mv3', import.meta.url))
const ctx = await chromium.launchPersistentContext(profile, {
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
const report = { errors: [], requests: [] }
ctx.on('page', (p) => p.on('pageerror', (e) => report.errors.push(e.message)))
ctx.on('request', (r) => {
  if (/^https?:/.test(r.url())) report.requests.push(r.url())
})
const base = 'chrome-extension://fddknloecifbbeomieckhnegffdobgni/app.html#'
try {
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.scanCounts = { folder: 0, opfs: 0, index: 0 }
    const values = FileSystemDirectoryHandle.prototype.values
    FileSystemDirectoryHandle.prototype.values = function (...args) {
      if (this.name === 'test-library') window.scanCounts.folder++
      if (this.name === 'recordings') window.scanCounts.opfs++
      return values.apply(this, args)
    }
    const entries = FileSystemDirectoryHandle.prototype.entries
    FileSystemDirectoryHandle.prototype.entries = function (...args) {
      if (this.name === 'recordings') window.scanCounts.opfs++
      return entries.apply(this, args)
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'index') window.scanCounts.index++
      return put.apply(this, args)
    }
  })
  await page.goto(base + '/')
  await page.evaluate(() => chrome.storage.local.set({ locale: 'en' }))
  await page.getByRole('heading', { name: 'History', exact: true }).waitFor()
  const refresh = page.getByRole('button', { name: 'Refresh and rebuild list' })
  const initialIndex = await page.evaluate(() => window.scanCounts.index)
  await refresh.click()
  await page.waitForFunction((n) => window.scanCounts.index > n, initialIndex)
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Refresh and rebuild list',
    )
    return button && !button.disabled
  })
  const before = await page.evaluate(() => ({ ...window.scanCounts }))
  const updatedTitle = 'OPFS changed while History stays visible ' + Date.now()
  await page.evaluate(async (title) => {
    const root = await navigator.storage.getDirectory()
    const dir = await (
      await root.getDirectoryHandle('recordings')
    ).getDirectoryHandle('legacy-audio')
    const h = await dir.getFileHandle('manifest.json')
    const raw = JSON.parse(await (await h.getFile()).text())
    raw.title = title
    const w = await h.createWritable()
    await w.write(JSON.stringify(raw))
    await w.close()
  }, updatedTitle)
  await page.getByRole('link', { name: updatedTitle, exact: true }).waitFor()
  await page.waitForTimeout(6500)
  const after = await page.evaluate(() => ({ ...window.scanCounts }))
  report.history = {
    before,
    after,
    pass:
      after.folder === before.folder && after.index === before.index && after.opfs > before.opfs,
  }
  await refresh.click()
  await page.waitForFunction((n) => window.scanCounts.index > n, after.index)
  report.history.explicitRefresh = true
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle('test-library')
    const original = await folder.getDirectoryHandle('2026-09-28_fixture')
    const dir = await folder.getDirectoryHandle('performance', { create: true })
    const write = async (name, value) => {
      const h = await dir.getFileHandle(name, { create: true })
      const w = await h.createWritable()
      await w.write(value)
      await w.close()
    }
    const raw = JSON.parse(
      await (await (await original.getFileHandle('meeting.json')).getFile()).text(),
    )
    await write(
      'meeting.json',
      JSON.stringify({
        ...raw,
        id: 'performance',
        title: 'Synthetic 2000-segment transcript',
        speakerAliases: {},
        speakers: [{ id: '0', name: 'Alice' }],
      }),
    )
    await write(
      'transcript.json',
      JSON.stringify({
        language: 'en',
        segments: Array.from({ length: 2000 }, (_, i) => ({
          startMs: i * 5,
          endMs: i * 5 + 5,
          speakerId: '0',
          text: 'Perf segment ' + i,
        })),
      }),
    )
    await write('video.mp4', await (await original.getFileHandle('video.mp4')).getFile())
  })
  await page.goto(base + '/meeting/performance')
  await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
  assert.equal(await page.locator('[data-segment]').count(), 2000)
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('Perf segment')
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await page.evaluate(() => {
    window.textWork = 0
    const lower = String.prototype.toLocaleLowerCase
    String.prototype.toLocaleLowerCase = function (...args) {
      if (this.startsWith('Perf segment ')) window.textWork++
      return lower.apply(this, args)
    }
  })
  await page.evaluate(async () => {
    const video = document.querySelector('video')
    video.pause()
    for (let i = 0; i < 20; i++) {
      video.currentTime = 1 + i * 0.03
      video.dispatchEvent(new Event('timeupdate'))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
  })
  const textWork = await page.evaluate(() => window.textWork)
  const active = await page.locator('[data-segment][aria-current="true"]').count()
  report.playback = {
    segments: 2000,
    ticks: 20,
    textWork,
    active,
    pass: textWork < 200 && active === 1,
  }
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('no matching segment')
  assert.equal(await page.locator('[data-segment]').count(), 0)
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('Perf segment 1999')
  assert.equal(await page.locator('[data-segment]').count(), 1)
  report.playback.searchStillWorks = true
  await page.screenshot({ path: resolve(output, 'browser-output/performance.png'), fullPage: true })
  report.pass =
    report.history.pass &&
    report.playback.pass &&
    report.errors.length === 0 &&
    report.requests.length === 0
  await writeFile(
    resolve(output, 'browser-output/performance.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.pass)
} finally {
  await ctx.close()
}
