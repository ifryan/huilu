// 自动化脚本公用：用 Chrome for Testing 加载 spikes/extension，打开 lab.html
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const EXT = join(ROOT, 'extension')
// 每次运行独立的浏览器 profile，允许多个验证脚本并行
const PROFILE = join(ROOT, `out/profile-${process.pid}`)

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}

/** 找 Chrome 可执行文件：CHROME_PATH 环境变量，或 Playwright 缓存里的 Chrome for Testing */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const cache = join(homedir(), '.cache/ms-playwright')
  const dir = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .at(-1)
  if (!dir)
    throw new Error('未找到 Chrome：设置 CHROME_PATH，或运行 npx playwright install chromium')
  return join(cache, dir, 'chrome-linux64/chrome')
}

export async function launch({ headless = true, extraArgs = [] } = {}) {
  mkdirSync(PROFILE, { recursive: true })
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: chromePath(),
    headless: false, // 由下面的 --headless=new 控制：旧 headless 不支持插件
    acceptDownloads: true,
    args: [
      ...(headless ? ['--headless=new'] : []),
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...extraArgs,
    ],
  })
  let [sw] = context.serviceWorkers()
  sw ??= await context.waitForEvent('serviceworker')
  const extId = new URL(sw.url()).host
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extId}/lab.html`)
  await page.waitForFunction(() => window.spike)
  const version = await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)[1])
  return { context, page, extId, version }
}

/**
 * 本次启动的所有 Chrome 进程（按命令行里的 profile 路径识别）：累计 CPU 秒数与常驻内存。
 * 插件的后台、离屏文档、lab 页面同属一个插件站点，通常共用一个 renderer 进程。
 */
export function processSnapshot() {
  const hz = 100 // Linux USER_HZ
  const out = []
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      // Chrome 会改写 argv，cmdline 里参数可能以空格而不是 \0 分隔
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0 ]/)
      if (!cmd[0].includes('chrome')) continue
      const isRoot = cmd.some((a) => a.includes(PROFILE))
      const type = cmd.find((a) => a.startsWith('--type='))?.slice(7) ?? 'browser'
      const sub = cmd.find((a) => a.startsWith('--utility-sub-type='))?.slice(19)
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
      const status = readFileSync(`/proc/${pid}/status`, 'utf8')
      out.push({
        pid: Number(pid),
        ppid: Number(stat[1]),
        isRoot,
        type: sub
          ? `utility:${sub.split('.').at(-1)}`
          : cmd.includes('--extension-process')
            ? 'renderer(extension)'
            : type,
        cpuS: (Number(stat[11]) + Number(stat[12])) / hz,
        rssMB: Math.round(Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) / 1024),
      })
    } catch {
      /* 进程已退出 */
    }
  }
  // 只保留本次启动的 Chrome 进程树
  const keep = new Set(out.filter((p) => p.isRoot && p.type === 'browser').map((p) => p.pid))
  let grew = true
  while (grew) {
    grew = false
    for (const p of out) if (!keep.has(p.pid) && keep.has(p.ppid)) (keep.add(p.pid), (grew = true))
  }
  return out.filter((p) => keep.has(p.pid)).map(({ isRoot: _i, ppid: _p, ...p }) => p)
}

export async function download(page, fn, dir) {
  mkdirSync(dir, { recursive: true })
  const saved = []
  page.on('download', async (d) => {
    const path = join(dir, d.suggestedFilename())
    saved.push(d.saveAs(path).then(() => path))
  })
  await fn()
  // 等所有下载事件触发并保存完成
  await new Promise((r) => setTimeout(r, 3000))
  return Promise.all(saved)
}
