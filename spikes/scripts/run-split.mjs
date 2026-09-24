// Groq 25MB 切片验证：生成一段「5.5 秒有声 + 1.5 秒静音」循环的 Opus 音频，
// 用很小的上限强制切片，检查每片大小、切点是否落在静音里、各片时长之和是否等于原时长。
//
// node scripts/run-split.mjs [--minutes 40] [--max-mb 2]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, launch, ROOT } from './lib.mjs'

const minutes = Number(arg('minutes', 40))
const maxMB = Number(arg('max-mb', 2))
const dir = join(ROOT, 'out/split')
mkdirSync(dir, { recursive: true })
const src = join(dir, `speechlike-${minutes}m.webm`)
execFileSync('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  `aevalsrc='(0.3*sin(2*PI*220*t)+0.2*sin(2*PI*330*t)+0.05*random(0))*lt(mod(t,7),5.5)':s=48000:d=${minutes * 60}`,
  '-ac',
  '1',
  '-c:a',
  'libopus',
  '-b:a',
  '24k',
  src,
])

const { context, page } = await launch()
await page.setInputFiles('#tr-file', src)
const result = await page.evaluate(
  async (maxBytes) => {
    const file = document.getElementById('tr-file').files[0]
    const t = performance.now()
    const pieces = await window.spike.splitAudio(file, { maxBytes })
    const out = []
    for (const p of pieces) {
      const probe = await window.spike.probe(p.blob)
      out.push({
        offsetS: +p.offsetS.toFixed(2),
        MB: +(p.blob.size / 2 ** 20).toFixed(2),
        durationS: +probe.duration.toFixed(2),
      })
    }
    return {
      sourceMB: +(file.size / 2 ** 20).toFixed(2),
      ms: Math.round(performance.now() - t),
      pieces: out,
    }
  },
  maxMB * 2 ** 20,
)
await context.close()

result.maxMB = maxMB
result.sourceDurationS = minutes * 60
result.sumDurationS = +result.pieces.reduce((s, p) => s + p.durationS, 0).toFixed(2)
// 切点在每 7 秒周期中的位置：>= 5.5 表示落在静音段
result.cutPhases = result.pieces.slice(1).map((p) => +(p.offsetS % 7).toFixed(2))
result.allCutsInSilence = result.cutPhases.every((ph) => ph >= 5.5 && ph <= 7)
result.allUnderLimit = result.pieces.every((p) => p.MB <= maxMB)
writeFileSync(join(dir, 'report.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
const durationOk = Math.abs(result.sumDurationS - result.sourceDurationS) < 1
if (!result.allCutsInSilence || !result.allUnderLimit || !durationOk) {
  console.error('FAILED: 切点未全部落在静音段、切片超限或时长不守恒')
  process.exitCode = 1
}
