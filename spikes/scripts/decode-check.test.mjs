// decodeErrors 的回归测试：用 ffmpeg 现场生成 WebM/Opus 样本，确认只忽略文件末尾的 Opus 解析器误报，
// 中途坏包、文件截断仍会计为错误。运行：node --test scripts/decode-check.test.mjs（需要 ffmpeg / ffprobe）
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeErrors } from './avsync.mjs'

let dir
let clean

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'huilu-decode-'))
  clean = join(dir, 'clean.webm')
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=3',
    '-ac',
    '2',
    '-c:a',
    'libopus',
    '-frame_duration',
    '60',
    clean,
  ])
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('完好文件：末尾的 Opus 解析器误报被忽略但保留记录', () => {
  const r = decodeErrors(clean)
  assert.equal(r.count, 0, JSON.stringify(r))
  assert.equal(r.ignored.length, 1)
  assert.equal(r.streams[0].frames, r.streams[0].packets)
})

test('中途 Opus 包头损坏：计为错误', () => {
  const packets = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'quiet',
      '-show_entries',
      'packet=pos',
      '-of',
      'json',
      clean,
    ]).toString(),
  ).packets
  const bytes = readFileSync(clean)
  // Matroska SimpleBlock：1 字节轨道号 + 2 字节时间码 + 1 字节标志之后才是 Opus 包；
  // 改成 code 3 且帧数为 0 的非法 TOC
  const at = Number(packets[Math.floor(packets.length / 2)].pos) + 4
  bytes[at] = 0x03
  bytes[at + 1] = 0x00
  const bad = join(dir, 'bad-toc.webm')
  writeFileSync(bad, bytes)
  const r = decodeErrors(bad)
  assert.ok(r.count > 0, JSON.stringify(r))
  assert.equal(r.ignored.length, 0)
})

test('文件被截断：计为错误', () => {
  const bytes = readFileSync(clean)
  const cut = join(dir, 'truncated.webm')
  writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length * 0.6) + 7))
  const r = decodeErrors(cut)
  assert.ok(r.count > 0, JSON.stringify(r))
})
