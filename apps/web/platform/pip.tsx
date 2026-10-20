import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
interface DocumentPip {
  window?: Window
  requestWindow(options: { width: number; height: number }): Promise<Window>
}
export const documentPip = (window as unknown as { documentPictureInPicture?: DocumentPip })
  .documentPictureInPicture
export function useRecordingWindow(active: boolean) {
  const [target, setTarget] = useState<HTMLElement>()
  const open = async () => {
    if (!documentPip) return
    if (documentPip.window) {
      documentPip.window.focus()
      return
    }
    const pip = await documentPip.requestWindow({ width: 360, height: 400 })
    pip.document.title = '会录 HuiLu'
    pip.document.documentElement.lang = document.documentElement.lang
    for (const style of document.querySelectorAll('link[rel="stylesheet"], style'))
      pip.document.head.append(style.cloneNode(true))
    const root = pip.document.createElement('div')
    root.className = 'p-4'
    pip.document.body.append(root)
    pip.addEventListener('pagehide', () => setTarget(undefined), { once: true })
    setTarget(root)
  }
  useEffect(() => {
    if (!active) documentPip?.window?.close()
  }, [active])
  useEffect(() => () => documentPip?.window?.close(), [])
  return { open, render: (node: ReactNode) => (target ? createPortal(node, target) : null) }
}
