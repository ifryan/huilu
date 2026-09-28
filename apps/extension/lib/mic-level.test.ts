import { describe, expect, it } from 'vitest'
import { levelFromSamples, smoothLevel } from './mic-level'

const constant = (value: number, n = 1024) => new Float32Array(n).fill(value)

describe('levelFromSamples', () => {
  it('静音与空帧为 0', () => {
    expect(levelFromSamples(constant(0))).toBe(0)
    expect(levelFromSamples(new Float32Array(0))).toBe(0)
  })

  it('满幅为 1，-60 dBFS 以下为 0', () => {
    expect(levelFromSamples(constant(1))).toBe(1)
    expect(levelFromSamples(constant(-1))).toBe(1)
    expect(levelFromSamples(constant(0.0005))).toBe(0)
  })

  it('-30 dBFS 落在中间', () => {
    expect(levelFromSamples(constant(10 ** (-30 / 20)))).toBeCloseTo(0.5, 5)
  })
})

describe('smoothLevel', () => {
  it('上升立即跟随，下降逐帧回落', () => {
    expect(smoothLevel(0.2, 0.8)).toBe(0.8)
    expect(smoothLevel(0.8, 0)).toBeCloseTo(0.76, 5)
    expect(smoothLevel(0.02, 0)).toBe(0)
  })
})
