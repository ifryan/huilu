/**
 * 录制窗口：窗口 / 屏幕录制在这个可见的小窗口里进行（标签页录制仍在离屏文档）。
 * desktopCapture 的选择框只能从可见页面弹出，得到的 streamId 也只能在同一个页面里取流，
 * 所以这里弹选择框、取流并运行一个 RecorderController；后台按消息转发暂停 / 继续 / 结束。
 */
import { RecorderController, RecordingStore, browserMediaBackend } from '@huilu/recorder'
import { onMessage, sendMessage } from '@/lib/messaging'
import { mount } from '@/lib/mount'
import { chooseDesktopSource } from '@/platform/capture'
import { RecorderWindow } from './RecorderWindow'

const controller = new RecorderController({
  store: new RecordingStore(() => navigator.storage.getDirectory()),
  media: browserMediaBackend,
  onFinished: ({ meeting, ...result }) => {
    void sendMessage('recordingFinished', { ...result, saved: meeting !== undefined }).catch(
      (e: unknown) => console.error('[huilu] failed to notify background', e),
    )
  },
})

onMessage('window:start', async ({ data }) => {
  if (data.source === 'tab') throw new Error('Tab recording runs in the offscreen document')
  const grant = await chooseDesktopSource(data.source)
  return controller.start({ ...data, streamId: grant.streamId, sourceAudio: grant.sourceAudio })
})
onMessage('window:pause', () => controller.pause())
onMessage('window:resume', () => controller.resume())
onMessage('window:stop', () => controller.stop())
onMessage('window:status', () => controller.status())

// 录制中关闭窗口会中断录制：浏览器会先询问一次
window.addEventListener('beforeunload', (event) => {
  if (controller.status().state !== 'idle') event.preventDefault()
})

void mount(<RecorderWindow />).then(() => sendMessage('recorderWindowReady'))
