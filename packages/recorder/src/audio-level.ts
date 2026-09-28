/** 电平条下限：-60 dBFS 以下视为静音 */
const FLOOR_DB = -60
/** 每帧最多回落的比例，避免电平条随每一帧跳动 */
const DECAY_PER_FRAME = 0.04

/** 一帧采样（-1…1）的 RMS 电平，按 dBFS 映射到 0…1 */
export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) sum += s * s
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

/** 上升立即跟随，下降按固定速度回落 */
export function smoothLevel(previous: number, next: number): number {
  return next >= previous ? next : Math.max(next, previous - DECAY_PER_FRAME)
}
