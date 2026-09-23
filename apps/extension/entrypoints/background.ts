import { browser, defineBackground, storage } from '#imports'
import { onMessage, type RecorderStatus } from '@/lib/messaging'
import { onboardedSetting } from '@/lib/settings'
import { openAppPage } from '@/platform'

const recorderStatus = storage.defineItem<RecorderStatus>('session:recorderStatus', {
  fallback: { state: 'idle' },
})

/**
 * 后台 Service Worker 只做调度，随时可能被浏览器回收；
 * 录制和耗时的处理任务放在离屏文档（entrypoints/offscreen）中执行。
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install' && !(await onboardedSetting.getValue())) {
      await openAppPage('/onboarding')
    }
  })

  onMessage('getRecorderStatus', () => recorderStatus.getValue())
  onMessage('openApp', ({ data }) => openAppPage(data))
})
