// avSync + syncVerdict 回归测试：用 ffmpeg 生成「闪白 + 哔声」对齐的样本，再人为延后音频，
// 确认测量本身接近 0、阈值按每个配对点判定、整周期的错配不会被当成同步。
// 运行：node --test scripts/avsync.test.mjs（需要 ffmpeg）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { alignPulses, avSync, markerTimes, syncVerdict } from './avsync.mjs'

let dir
const windows = [
  [0, 7],
  [7, 7],
]

const DURATION_S = 15

/** 标记处为 1 的 ffmpeg 表达式：periodic 为每秒整点（旧的测试源），否则为 markerTimes 的非周期序列 */
function pulseExpr(v, periodic) {
  if (periodic) return `lt(mod(${v}\\,1)\\,0.1)`
  return markerTimes(DURATION_S)
    .map((t) => `between(${v}\\,${t}\\,${(t + 0.0999).toFixed(4)})`)
    .join('+')
}

/**
 * 15fps H.264（无 B 帧）+ Opus 分片 MP4，与 Chrome MediaRecorder 输出同类；audioDelayMs 为音频整体延后。
 * 默认用非周期标记；periodic 为旧的每秒一次标记，只用来确认它不能判定通过
 */
function sample(name, audioDelayMs, { periodic = false } = {}) {
  const file = join(dir, `${name}.mp4`)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=320x180:r=15,format=yuv420p,geq=lum='if(${pulseExpr('T', periodic)}\\,235\\,30)':cb=128:cr=128`,
    '-f',
    'lavfi',
    '-i',
    `sine=f=1000:r=48000,volume='if(${pulseExpr('t', periodic)}\\,0.5\\,0)':eval=frame`,
    '-t',
    String(DURATION_S),
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
  // 非周期标记平均 1.125 秒一个：两个 7 秒窗口约 12 个标记，边缘的闪白可能没有对应哔声
  assert.ok(v.samples >= 10, JSON.stringify(v))
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

// PR #6 审查 r4092377794：每秒一次的标记下，音频晚 850ms 会被「最近的哔声」配成早 150ms 而通过
test('音频延后 850ms（非周期标记）：测得约 850ms，判定不通过', () => {
  const v = sample('late850', 850)
  assert.ok(Math.abs(v.medianMs - 850) <= 40, JSON.stringify(v))
  assert.ok(v.over > 0, JSON.stringify(v))
  assert.equal(v.pass, false)
})

test('周期标记无法确定对应关系：延后 850ms 与对齐的样本都不能判定通过', () => {
  const late = sample('periodic850', 850, { periodic: true })
  assert.equal(late.pass, false, JSON.stringify(late))
  assert.ok(late.ambiguousWindows.length > 0, JSON.stringify(late))
  const aligned = sample('periodic0', 0, { periodic: true })
  assert.equal(aligned.pass, false, JSON.stringify(aligned))
})

test('按序号对齐：整周期错位的配对不会被选中', () => {
  const flashes = markerTimes(12)
  const late = alignPulses(
    flashes,
    flashes.map((t) => t + 0.85),
  )
  assert.equal(late.ambiguous, false)
  assert.ok(
    late.offsetsMs.every((o) => o === 850),
    JSON.stringify(late),
  )
  // 窗口开头少一个哔声、结尾多一个：仍按正确的序号对齐
  const shifted = alignPulses(
    flashes,
    [...flashes.slice(1), 12.3].map((t) => t + 0.12),
  )
  assert.equal(shifted.ambiguous, false)
  assert.ok(
    shifted.offsetsMs.every((o) => o === 120),
    JSON.stringify(shifted),
  )
  // 相邻间隔各不相同
  const gaps = flashes.slice(1).map((t, i) => +(t - flashes[i]).toFixed(3))
  assert.ok(
    gaps.every((g, i) => i === 0 || g !== gaps[i - 1]),
    JSON.stringify(gaps),
  )
})

test('没有配对点、大量未配对或对应关系不确定：判定不通过', () => {
  const w = (over) => ({ window: 'w', ambiguous: false, ...over })
  assert.equal(syncVerdict([w({ offsetsMs: [], pairs: 0, flashes: 7 })]).pass, false)
  assert.equal(syncVerdict([w({ offsetsMs: [10, 12], pairs: 2, flashes: 7 })]).pass, false)
  const ok = w({ offsetsMs: [10, 12, 8, 9, 11, 10], pairs: 6, flashes: 7 })
  assert.equal(syncVerdict([ok]).pass, true)
  assert.equal(syncVerdict([{ ...ok, ambiguous: true }]).pass, false)
  // 旧格式没有 ambiguous 字段：不能当作已确定对应关系
  const { ambiguous, ...legacy } = ok
  void ambiguous
  assert.equal(syncVerdict([legacy]).pass, false)
})
