import { expect, it } from 'vitest'
import { fitRecorderBounds, initialRecorderBounds } from './recorder-window-bounds'

it('centers the initial host on the initiating window, including a negative-coordinate display', () => {
  expect(initialRecorderBounds({ left: -1800, top: 100, width: 1400, height: 900 })).toEqual({
    left: -1580,
    top: 190,
    width: 960,
    height: 720,
  })
  expect(initialRecorderBounds()).toEqual({ width: 960, height: 720 })
})

it.each([
  { left: 0, top: 25, width: 1920, height: 1055 },
  { left: -1920, top: -1080, width: 1920, height: 1040 },
  { left: 1920, top: 0, width: 800, height: 600 },
  // Logical display size at high OS scaling. No devicePixelRatio multiplication.
  { left: 0, top: 0, width: 640, height: 480 },
])('fits an oversized/offscreen anchor within the work area %j', (available) => {
  const bounds = fitRecorderBounds({ left: -4000, top: 4000, width: 4000, height: 2000 }, available)
  expect(bounds.left).toBeGreaterThanOrEqual(available.left + 32)
  expect(bounds.top).toBeGreaterThanOrEqual(available.top + 32)
  expect(bounds.left + bounds.width).toBeLessThanOrEqual(available.left + available.width - 32)
  expect(bounds.top + bounds.height).toBeLessThanOrEqual(available.top + available.height - 32)
  expect(bounds.width).toBe(Math.min(960, available.width - 64))
  expect(bounds.height).toBe(Math.min(720, available.height - 64))
})

it('expands a small browser host about its center before clamping to the screen', () => {
  const anchor = initialRecorderBounds({ left: 800, top: 400, width: 420, height: 340 })
  expect(
    fitRecorderBounds(anchor as Required<typeof anchor>, {
      left: 0,
      top: 25,
      width: 1920,
      height: 1055,
    }),
  ).toEqual({ left: 530, top: 210, width: 960, height: 720 })
})
