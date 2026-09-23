// 验证项 4：在插件页面（chrome-extension:// 源）里跑转写全流程，确认 host_permissions 下无 CORS 问题。
//
//   DASHSCOPE_API_KEY=sk-... node scripts/transcribe.mjs --provider paraformer --file meeting.webm [--region intl]
//   GROQ_API_KEY=gsk_...     node scripts/transcribe.mjs --provider groq --file meeting.webm [--max-mb 25]
//
// 不设置 Key 时使用无效 Key 做连通性检查：预期拿到服务端的 401 JSON（而不是 CORS / 网络错误）。
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, launch, ROOT } from './lib.mjs'

const provider = arg('provider', 'paraformer')
const dir = join(ROOT, 'out/transcribe')
mkdirSync(dir, { recursive: true })
let file = arg('file')
if (!file) {
  file = join(dir, 'tone-10s.webm')
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=10',
    '-c:a',
    'libopus',
    file,
  ])
}

const { context, page } = await launch()
await page.setInputFiles('#tr-file', file)
const result = await page.evaluate(
  async ({ provider, env, region, maxMB }) => {
    const [{ transcribeWithParaformer, DASHSCOPE_ENDPOINTS }, oa, { splitAudio }] =
      await Promise.all([
        import('./lib/dashscope.js'),
        import('./lib/openai-compatible.js'),
        import('./lib/split.js'),
      ])
    const blob = document.getElementById('tr-file').files[0]
    const logs = []
    const log = (step, detail) => logs.push({ t: Date.now(), step, ...detail })
    try {
      if (provider === 'paraformer') {
        const r = await transcribeWithParaformer(blob, blob.name, {
          apiKey: env.DASHSCOPE_API_KEY || 'sk-invalid',
          baseUrl: DASHSCOPE_ENDPOINTS[region],
          log,
        })
        return { ok: true, logs, ...r }
      }
      const preset = oa.OPENAI_COMPATIBLE_PRESETS.groq
      const pieces = await splitAudio(blob, {
        maxBytes: Math.min(preset.maxFileBytes, maxMB * 2 ** 20),
        log,
      })
      const r = await oa.transcribePieces(pieces, {
        ...preset,
        apiKey: env.GROQ_API_KEY || 'gsk_invalid',
        log,
      })
      return { ok: true, logs, ...r }
    } catch (e) {
      // TypeError: Failed to fetch 表示网络 / CORS 问题；带 status 的错误表示请求已到达服务端
      return {
        ok: false,
        logs,
        error: String(e),
        status: e.status,
        body: e.body,
        reachedServer: !!e.status,
      }
    }
  },
  {
    provider,
    env: {
      DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
    },
    region: arg('region', 'cn'),
    maxMB: Number(arg('max-mb', 25)),
  },
)
await context.close()
const out = join(dir, `${provider}-${Date.now()}.json`)
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2).slice(0, 4000))
console.log('→', out)
