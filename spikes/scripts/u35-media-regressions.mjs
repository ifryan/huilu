import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
const output = resolve(process.env.U35_OUTPUT_DIR ?? 'output/playwright/u35')
const previous = JSON.parse(await readFile(resolve(output, 'browser-output/results.json'), 'utf8'))
assert.ok(previous.profile.startsWith(resolve(output, 'browser-output') + sep))
const extension = fileURLToPath(new URL('../../apps/extension/.output/chrome-mv3', import.meta.url))
const ctx = await chromium.launchPersistentContext(previous.profile, {
  executablePath: process.env.U35_CHROMIUM_PATH ?? chromium.executablePath(),
  headless: true,
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    '--disable-background-networking',
    '--disable-component-update',
  ],
})
const errors = [],
  requests = [],
  results = []
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
ctx.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
ctx.on('request', (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url())
})
const base = 'chrome-extension://fddknloecifbbeomieckhnegffdobgni/app.html#'
let page
try {
  page = await ctx.newPage()
  await page.goto(base + '/')
  await page.evaluate(async () => {
    await chrome.storage.local.set({ locale: 'en', onboarded: true })
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle('test-library')
    const original = await folder.getDirectoryHandle('2026-09-28_fixture')
    const recordings = await root.getDirectoryHandle('recordings', { create: true })
    const write = async (dir, name, value) => {
      const h = await dir.getFileHandle(name, { create: true })
      const w = await h.createWritable()
      await w.write(value)
      await w.close()
    }
    const raw = JSON.parse(
      await (await (await original.getFileHandle('meeting.json')).getFile()).text(),
    )
    delete raw.media
    delete raw.schemaVersion
    for (const [id, kinds] of [
      ['legacy-video', ['video', 'audio']],
      ['legacy-audio', ['audio']],
      ['no-media', []],
      ['empty-track', ['audio']],
    ]) {
      const dir = await recordings.getDirectoryHandle(id, { create: true })
      const tracks = {}
      for (const kind of kinds) {
        const audio = kind === 'audio'
        const file = await (
          await original.getFileHandle(audio ? 'audio.webm' : 'video.mp4')
        ).getFile()
        const track = await dir.getDirectoryHandle(kind, { create: true })
        const empty = id === 'empty-track'
        if (!empty) await write(track, '000001.part', file)
        tracks[kind] = {
          mimeType: audio ? 'audio/webm;codecs=opus' : 'video/mp4',
          chunks: empty ? 0 : 1,
          bytes: empty ? 0 : file.size,
          sizes: empty ? [] : [file.size],
        }
      }
      const mode = kinds.includes('video') ? 'video' : 'audio'
      await write(
        dir,
        'meeting.json',
        JSON.stringify({ ...raw, id, title: id, mode, status: 'processing' }),
      )
      await write(
        dir,
        'manifest.json',
        JSON.stringify({
          version: 1,
          id,
          title: id,
          mode,
          videoSource: 'tab',
          language: 'en',
          microphone: false,
          state: 'stopped',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          activeMs: 12000,
          tracks,
          endReason: 'user',
        }),
      )
    }
  })
  for (const [id, kind] of [
    ['legacy-video', 'video'],
    ['legacy-audio', 'audio'],
  ]) {
    await page.goto(base + '/meeting/' + id)
    await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
    await page.locator(kind).waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.waitForFunction((kind) => document.querySelector(kind)?.currentTime > 0, kind)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByText('Export', { exact: true }).click()
    const original = page.getByRole('button', { name: 'Download original media', exact: true })
    assert.equal(await original.isEnabled(), true)
    const downloaded = page.waitForEvent('download')
    await original.click()
    const download = await downloaded
    assert.ok(download.suggestedFilename().endsWith(kind === 'video' ? '.mp4' : '.webm'))
    await download.saveAs(
      resolve(output, 'browser-output', id + (kind === 'video' ? '.mp4' : '.webm')),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Video · MP4', exact: true }).isEnabled(),
      kind === 'video',
    )
    if (kind === 'video') {
      const mp4 = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Video · MP4', exact: true }).click()
      await (await mp4).saveAs(resolve(output, 'browser-output/legacy-export.mp4'))
    }
    // AAC is unavailable on some Chromium builds; a present audio track must
    // still reach the capability check rather than the missing-audio message.
    assert.equal(
      await page
        .getByText(
          'No transcription audio was recorded, so this cannot be transcribed. The video was kept and can be previewed or downloaded',
          { exact: true },
        )
        .count(),
      0,
    )
    const m4a = page.getByRole('button', { name: 'Audio · M4A', exact: true })
    if (await m4a.isEnabled()) {
      const exported = page.waitForEvent('download')
      await m4a.click()
      await (await exported).saveAs(resolve(output, 'browser-output', id + '.m4a'))
      results.push(id + ': M4A downloaded')
    } else {
      await page
        .getByText('This browser cannot encode M4A. Download the original audio instead.', {
          exact: true,
        })
        .waitFor()
      results.push(id + ': M4A disabled only by browser AAC capability')
    }
    await page.screenshot({ path: resolve(output, 'browser-output', id + '.png'), fullPage: true })
    results.push(id + ': correct player, advancing playback, original download, MP4 eligibility')
  }
  for (const id of ['no-media', 'empty-track']) {
    await page.goto(base + '/meeting/' + id)
    await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
    await page.getByText('Export', { exact: true }).click()
    for (const name of ['Download original media', 'Video · MP4', 'Audio · M4A'])
      assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true)
    assert.equal(await page.locator('video,audio').count(), 0)
    results.push(id + ': absent media stays unavailable')
  }
  await page.goto(base + '/meeting/legacy-video')
  await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: resolve(output, 'browser-output/legacy-mobile.png'),
    fullPage: true,
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.ok((await page.title()).includes('会录') || (await page.title()).includes('HuiLu'))
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  await writeFile(
    resolve(output, 'browser-output/media-regressions.json'),
    JSON.stringify(
      {
        results,
        errors,
        requests,
        url: page.url(),
        title: await page.title(),
        browser: ctx.browser()?.version(),
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ results, errors, requests }, null, 2))
} catch (e) {
  console.error(e)
  if (page) {
    await mkdir(resolve(output, 'browser-output'), { recursive: true })
    await page
      .screenshot({ path: resolve(output, 'browser-output/media-failure.png'), fullPage: true })
      .catch(() => {})
    console.error(await page.locator('body').innerText())
  }
  process.exitCode = 1
} finally {
  await ctx.close()
}
