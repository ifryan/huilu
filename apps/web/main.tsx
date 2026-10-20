import { RouterProvider } from '@tanstack/react-router'
import { mount } from '@/lib/mount'
import { router } from './router'
import { startRuntime } from '@/platform/runtime'
import { requestPersistence } from '@/platform/capabilities'
import './styles.css'
if (!isSecureContext || !navigator.storage?.getDirectory || !navigator.locks) {
  document.getElementById('root')!.textContent =
    '需要支持 OPFS 和 Web Locks 的安全浏览器。Use desktop Chrome on HTTPS / localhost.'
} else {
  void mount(<RouterProvider router={router} />)
    .then(() => {
      startRuntime()
      void requestPersistence()
    })
    .catch((error: unknown) => {
      document.getElementById('root')!.textContent = String(error)
    })
}
