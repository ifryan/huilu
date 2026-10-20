export interface WindowBounds {
  left: number
  top: number
  width: number
  height: number
}

const preferred = { width: 960, height: 720 }

/** Seed the popup on the initiating tab's display, even when another window has focus. */
export function initialRecorderBounds(parent?: Partial<WindowBounds>): Partial<WindowBounds> {
  if (
    !parent ||
    !Number.isFinite(parent.left) ||
    !Number.isFinite(parent.top) ||
    !parent.width ||
    !parent.height
  ) {
    return preferred
  }
  const width = Math.min(preferred.width, parent.width)
  const height = Math.min(preferred.height, parent.height)
  return {
    width,
    height,
    left: Math.round(parent.left! + (parent.width - width) / 2),
    top: Math.round(parent.top! + (parent.height - height) / 2),
  }
}

/** All inputs are logical screen pixels; never multiply by devicePixelRatio/page zoom. */
export function fitRecorderBounds(anchor: WindowBounds, available: WindowBounds): WindowBounds {
  // Leave room for native window decorations as well as taskbars/docks.
  const margin = 32
  const width = Math.max(1, Math.min(preferred.width, available.width - margin * 2))
  const height = Math.max(1, Math.min(preferred.height, available.height - margin * 2))
  const left = available.left + Math.min(margin, Math.max(0, (available.width - width) / 2))
  const top = available.top + Math.min(margin, Math.max(0, (available.height - height) / 2))
  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round(
      Math.max(
        left,
        Math.min(
          anchor.left + (anchor.width - width) / 2,
          available.left + available.width - width - margin,
        ),
      ),
    ),
    top: Math.round(
      Math.max(
        top,
        Math.min(
          anchor.top + (anchor.height - height) / 2,
          available.top + available.height - height - margin,
        ),
      ),
    ),
  }
}
