import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core')
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const output = resolve(process.env.U35_OUTPUT_DIR ?? 'output/playwright/u35')
await mkdir(output, { recursive: true })
process.chdir(output)
await mkdir('browser-output', { recursive: true })
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=15',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '12',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    'browser-output/fixture.mp4',
  ],
  { stdio: 'ignore' },
)
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    'browser-output/fixture.mp4',
    '-vn',
    '-c:a',
    'libopus',
    'browser-output/fixture.webm',
  ],
  { stdio: 'ignore' },
)
execFileSync(
  'ffmpeg',
  ['-y', '-i', 'browser-output/fixture.mp4', '-an', '-c:v', 'copy', 'browser-output/silent.mp4'],
  { stdio: 'ignore' },
)
const extension = fileURLToPath(new URL('../../apps/extension/.output/chrome-mv3', import.meta.url))
const profile = resolve('browser-output/profile-' + Date.now())
await mkdir(profile, { recursive: true })
const ctx = await chromium.launchPersistentContext(profile, {
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
const errors = []
const requests = []
const results = []
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
ctx.on('request', (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url())
})
try {
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
  const id = sw.url().split('/')[2]
  assert.equal(id, 'fddknloecifbbeomieckhnegffdobgni')
  const page = await ctx.newPage()
  await page.goto(`chrome-extension://${id}/app.html#/`)
  console.log('Loaded', id)
  const mp4 = (await readFile('browser-output/fixture.mp4')).toString('base64')
  const audio = (await readFile('browser-output/fixture.webm')).toString('base64')
  const silentVideo = (await readFile('browser-output/silent.mp4')).toString('base64')
  await page.evaluate(
    async ({ mp4, audio, silentVideo }) => {
      await chrome.storage.local.set({ locale: 'en', onboarded: true })
      const root = await navigator.storage.getDirectory()
      const folder = await root.getDirectoryHandle('test-library', { create: true })
      const write = async (dir, name, value) => {
        const h = await dir.getFileHandle(name, { create: true })
        const w = await h.createWritable()
        await w.write(value)
        await w.close()
      }
      const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
      const meeting = {
        schemaVersion: 1,
        id: 'fixture',
        title: 'Product review · Synthetic fixture',
        createdAt: '2026-09-28T08:00:00Z',
        durationMs: 12000,
        mode: 'video',
        language: 'en',
        speakers: [
          { id: '0', name: 'Alice' },
          { id: '1', name: 'Bob' },
        ],
        markers: [{ id: 'mark', atMs: 3000, label: 'Decision' }],
        status: 'ready',
        media: { video: { mimeType: 'video/mp4' }, audio: { mimeType: 'audio/webm;codecs=opus' } },
        providers: { transcription: 'fixture', llm: 'fixture' },
      }
      const transcript = {
        language: 'en',
        segments: [
          {
            startMs: 0,
            endMs: 4000,
            speakerId: '0',
            text: 'We reviewed the launch plan and agreed on a clear direction.',
          },
          {
            startMs: 4000,
            endMs: 8000,
            speakerId: '1',
            text: 'The prototype is ready. Searchable decisions help the team.',
          },
          {
            startMs: 8000,
            endMs: 12000,
            speakerId: '0',
            text: 'Next, we will validate accessibility and publish the checklist.',
          },
        ],
      }
      const summary = {
        keywords: ['Launch plan', 'Accessibility', 'Prototype'],
        overview:
          'The team reviewed the prototype and agreed to finish accessibility validation before launch. This is a synthetic meeting used for interface testing.',
        chapters: [
          { startMs: 0, title: 'Launch plan', summary: 'Review the launch scope and decisions.' },
          {
            startMs: 4000,
            title: 'Prototype review',
            summary: 'The prototype is ready for validation.',
          },
          {
            startMs: 8000,
            title: 'Next steps',
            summary: 'Validate accessibility and share the checklist.',
          },
        ],
        speakerSummaries: [
          { speakerId: '0', summary: 'Outlined the launch plan and next steps.' },
          { speakerId: '1', summary: 'Confirmed prototype readiness.' },
        ],
        keyPoints: ['Validate accessibility before launch.', 'Keep decisions searchable.'],
        actionItems: [{ text: 'Run accessibility checks', owner: 'Alice', due: 'Friday' }],
      }
      const dir = await folder.getDirectoryHandle('2026-09-28_fixture', { create: true })
      await write(dir, 'meeting.json', JSON.stringify(meeting))
      await write(dir, 'transcript.json', JSON.stringify(transcript))
      await write(dir, 'summary.json', JSON.stringify(summary))
      await write(dir, 'video.mp4', bytes(mp4))
      await write(dir, 'audio.webm', bytes(audio))
      const bad = await folder.getDirectoryHandle('damaged', { create: true })
      await write(bad, 'meeting.json', '{')
      const silent = await folder.getDirectoryHandle('silent-video', { create: true })
      await write(
        silent,
        'meeting.json',
        JSON.stringify({
          ...meeting,
          id: 'silent',
          title: 'Silent video',
          media: { video: { mimeType: 'video/mp4' } },
          providers: {},
          status: 'failed',
        }),
      )
      await write(silent, 'video.mp4', bytes(silentVideo))
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('huilu-handles', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('handles')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('handles', 'readwrite')
          tx.objectStore('handles').put(folder, 'dataFolder')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
      await chrome.storage.local.set({
        dataFolderAuthorized: { name: 'Synthetic library', at: Date.now() },
      })
    },
    { mp4, audio, silentVideo },
  )
  await page.reload()
  await page
    .getByRole('link', { name: 'Product review · Synthetic fixture', exact: true })
    .waitFor()
  results.push('Folder scan: valid records visible beside damaged record')
  await page.getByRole('link', { name: 'Product review · Synthetic fixture', exact: true }).click()
  await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor()
  await page.locator('video').waitFor()
  await page.getByRole('button', { name: /00:00:04 Prototype review/ }).click()
  await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 4)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  assert.equal(await page.locator('[data-segment="1"]').getAttribute('aria-current'), 'true')
  results.push('Chapter seek / video time / transcript highlight agree')
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('prototype')
  assert.equal(await page.locator('[data-segment]').count(), 1)
  assert.equal(await page.locator('mark').textContent(), 'prototype')
  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('')
  await page
    .getByRole('textbox', { name: 'Meeting title', exact: true })
    .fill('Edited synthetic meeting')
  await page.getByRole('textbox', { name: 'Meeting title', exact: true }).press('Enter')
  await page.getByText('All changes saved', { exact: true }).waitFor()
  await page.getByText('Manage speakers', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Speaker name: Alice', exact: true }).fill('Alicia')
  await page.getByRole('textbox', { name: 'Speaker name: Alice', exact: true }).press('Enter')
  await page.getByText('All changes saved', { exact: true }).waitFor()
  await page.getByText('Manage speakers', { exact: true }).click()
  const speakerFilter = page.getByRole('combobox', { name: 'Filter by speaker' })
  await speakerFilter.selectOption('1')
  assert.equal(await page.locator('[data-segment]').count(), 1)
  await page.getByRole('combobox', { name: 'Merge speaker', exact: true }).selectOption('1')
  await page.getByRole('combobox', { name: 'Into speaker', exact: true }).selectOption('0')
  await page.getByRole('button', { name: 'Merge speakers', exact: true }).click()
  await page.getByText('All changes saved', { exact: true }).waitFor()
  assert.equal(await speakerFilter.inputValue(), '0')
  assert.equal(await page.locator('[data-segment]').count(), 3)
  await speakerFilter.selectOption('')
  assert.equal(await page.locator('[data-segment]').count(), 3)
  results.push('Selected speaker B merged into A: filter remaps to A and transcript stays visible')
  await page.reload()
  await page.getByRole('textbox', { name: 'Meeting title', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Meeting title', exact: true }).inputValue(),
    'Edited synthetic meeting',
  )
  assert.equal(
    await page.getByRole('combobox', { name: 'Filter by speaker' }).locator('option').count(),
    2,
  )
  results.push('Title, speaker rename, and merge survive reload')
  await page.screenshot({ path: 'browser-output/result-en.png', fullPage: true })
  await page.getByText('Export', { exact: true }).click()
  for (const [label, file] of [
    ['Transcript · TXT', 'meeting.txt'],
    ['Subtitles · SRT', 'meeting.srt'],
    ['Summary · Markdown', 'summary.md'],
    ['Video · MP4', 'video.mp4'],
    ['Audio · M4A', 'audio.m4a'],
  ]) {
    const button = page.getByRole('button', { name: label, exact: true })
    if (await button.isDisabled()) {
      results.push(`${label}: disabled with reason`)
      continue
    }
    const downloaded = page.waitForEvent('download')
    await button.click()
    await (await downloaded).saveAs('browser-output/' + file)
    results.push(`${label}: downloaded`)
  }
  await page.goto(`chrome-extension://${id}/app.html#/`)
  await page.getByRole('link', { name: 'Edited synthetic meeting', exact: true }).waitFor()
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('huilu-library')
        req.onsuccess = resolve
        req.onerror = reject
      }),
  )
  await page.getByRole('button', { name: 'Refresh and rebuild list' }).click()
  await page.getByRole('link', { name: 'Edited synthetic meeting', exact: true }).waitFor()
  results.push('Deleted index rebuilt with persisted edited title')
  await page.screenshot({ path: 'browser-output/history-en.png', fullPage: true })
  await page.getByRole('link', { name: 'Silent video', exact: true }).click()
  await page.getByText('Export', { exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Audio · M4A', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Transcript · TXT', exact: true }).isDisabled(),
    true,
  )
  results.push('Video without transcript audio: incompatible exports disabled')
  await page.evaluate(() => chrome.storage.local.set({ locale: 'zh-CN' }))
  await page.goto(`chrome-extension://${id}/app.html#/meeting/fixture`)
  await page.getByRole('heading', { name: '逐字稿', exact: true }).waitFor()
  await page.screenshot({ path: 'browser-output/result-zh.png', fullPage: true })
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(requests.length, 0, JSON.stringify(requests))
  await writeFile(
    'browser-output/results.json',
    JSON.stringify({ results, errors, requests, profile }, null, 2),
  )
  console.log(JSON.stringify({ results, errors, requests }, null, 2))
} catch (e) {
  console.error(e)
  const page = ctx.pages().at(-1)
  if (page) {
    await page.screenshot({ path: 'browser-output/failure.png', fullPage: true }).catch(() => {})
    console.error((await page.locator('body').innerText()).slice(0, 10000))
  }
  process.exitCode = 1
} finally {
  await ctx.close()
}
