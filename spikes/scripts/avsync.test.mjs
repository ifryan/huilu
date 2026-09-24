// avSync + syncVerdict 回归测试：用 ffmpeg 生成「闪白 + 哔声」对齐的样本，再人为延后音频，
// 确认测量本身接近 0、阈值按每个配对点判定。运行：node --test scripts/avsync.test.mjs（需要 ffmpeg）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { avSync, syncVerdict } from './avsync.mjs'

let dir
const windows = [
  [0, 7],
  [7, 7],
]

/** 15fps H.264（无 B 帧）+ Opus 分片 MP4，与 Chrome MediaRecorder 输出同类；audioDelayMs 为音频整体延后 */
function sample(name, audioDelayMs) {
  const file = join(dir, `${name}.mp4`)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    "color=c=black:s=320x180:r=15,format=yuv420p,geq=lum='if(lt(mod(T\\,1)\\,0.1)\\,235\\,30)':cb=128:cr=128",
    '-f',
    'lavfi',
    '-i',
    "sine=f=1000:r=48000,volume='if(lt(mod(t\\,1)\\,0.1)\\,0.5\\,0)':eval=frame",
    '-t',
    '15',
    '-af',
    `adelay=${audioDelayMs}:all=1`,
    '-c:v',
    'libx264',
    '-bf',
    '0',
    '-g',
    '15',
    '-c:a',
    'libopus',
    '-movflags',
    '+frag_keyframe+empty_moov',
    file,
  ])
  return syncVerdict(avSync(file, windows))
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'huilu-avsync-'))
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('对齐样本：测量误差在一帧（67ms）以内，判定通过', () => {
  const v = sample('aligned', 0)
  assert.ok(v.samples >= 12, JSON.stringify(v))
  assert.ok(v.maxAbsMs <= 67, JSON.stringify(v))
  assert.equal(v.pass, true)
})

test('音频延后 150ms：测得约 150ms，未超 200ms', () => {
  const v = sample('late150', 150)
  assert.ok(Math.abs(v.medianMs - 150) <= 40, JSON.stringify(v))
  assert.equal(v.pass, true)
})

test('音频延后 260ms：超过 200ms，判定不通过', () => {
  const v = sample('late260', 260)
  assert.ok(v.over > 0, JSON.stringify(v))
  assert.equal(v.pass, false)
})

test('没有配对点或大量未配对：判定不通过', () => {
  assert.equal(syncVerdict([{ window: 'w', offsetsMs: [], pairs: 0, flashes: 7 }]).pass, false)
  assert.equal(
    syncVerdict([{ window: 'w', offsetsMs: [10, 12], pairs: 2, flashes: 7 }]).pass,
    false,
  )
  assert.equal(
    syncVerdict([{ window: 'w', offsetsMs: [10, 12, 8, 9, 11, 10], pairs: 6, flashes: 7 }]).pass,
    true,
  )
})
