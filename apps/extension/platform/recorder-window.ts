import { browser } from '#imports'
import { fitRecorderBounds } from '@/lib/recorder-window-bounds'

/** Run in recorder.html, where Screen describes the display containing this popup. */
export async function prepareRecorderWindow(): Promise<void> {
  const win = await browser.windows.getCurrent()
  if (win.id === undefined) throw new Error('The recording window is no longer available')
  // Chromium exposes availLeft/availTop without requiring multi-screen enumeration permission.
  const display = window.screen as Screen & { availLeft: number; availTop: number }
  const available = {
    left: display.availLeft,
    top: display.availTop,
    width: display.availWidth,
    height: display.availHeight,
  }
  const anchor = {
    left: win.left ?? available.left,
    top: win.top ?? available.top,
    width: win.width ?? available.width,
    height: win.height ?? available.height,
  }
  await browser.windows.update(win.id, {
    ...fitRecorderBounds(anchor, available),
    state: 'normal',
    focused: true,
  })
}
