/**
 * 离屏文档：长时间运行的工作都在这里执行
 * - 录制：采集标签页 / 屏幕 / 麦克风 → Web Audio 混音 → MediaRecorder → 分片写入 OPFS
 * - 会后处理：按 registries.pipeline 中登记的步骤依次执行（转写 → 纪要 → 关键帧 → 写入数据文件夹）
 *
 * 由后台通过 chrome.offscreen.createDocument 按需创建。离屏文档里只有 chrome.runtime 可用
 * （没有 chrome.storage），需要的设置由后台随消息传入。
 */
import { RecorderController, RecordingStore, browserMediaBackend } from '@huilu/recorder'
import { onMessage, sendMessage } from '@/lib/messaging'

const controller = new RecorderController({
  store: new RecordingStore(() => navigator.storage.getDirectory()),
  media: browserMediaBackend,
  onFinished: ({ meeting, ...result }) => {
    // meeting.json（status = processing）已写入 OPFS，处理管线从这里接手
    void sendMessage('recordingFinished', { ...result, saved: meeting !== undefined }).catch(
      (e: unknown) => console.error('[huilu] failed to notify background', e),
    )
  },
})

onMessage('offscreen:start', ({ data }) => controller.start(data))
onMessage('offscreen:pause', () => controller.pause())
onMessage('offscreen:resume', () => controller.resume())
onMessage('offscreen:stop', () => controller.stop())
onMessage('offscreen:status', () => controller.status())
onMessage('offscreen:listUnfinished', () => controller.listUnfinished())
onMessage('offscreen:recover', async ({ data: id }) => (await controller.recover(id)) ?? null)
onMessage('offscreen:discard', ({ data: id }) => controller.discard(id))
