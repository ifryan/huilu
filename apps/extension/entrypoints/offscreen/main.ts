/**
 * 离屏文档：长时间运行的工作都在这里执行
 * - 录制：采集标签页 / 屏幕 / 麦克风 → Web Audio 混音 → MediaRecorder → 分片写入 OPFS
 * - 会后处理：转写 → 纪要 → 写入数据文件夹（@huilu/pipeline 的持久化队列）
 *
 * 由后台通过 chrome.offscreen.createDocument 按需创建。离屏文档里只有 chrome.runtime 可用
 * （没有 chrome.storage / chrome.permissions），需要的设置向后台要。
 */
import { ProcessingQueue } from '@huilu/pipeline'
import { IdbJobStore } from '@huilu/pipeline/jobs'
import { createMediabunnySplitter } from '@huilu/pipeline/mediabunny'
import { RecorderController, RecordingStore, browserMediaBackend } from '@huilu/recorder'
import { sendResultNotification } from '@/lib/result-notification'
import { onMessage, sendMessage } from '@/lib/messaging'
import { recordingSource, resolveServices } from '@/lib/processing'
import { dataFolder, opfs } from '@/platform/storage'

const store = new RecordingStore(() => navigator.storage.getDirectory())

const controller = new RecorderController({
  store,
  media: browserMediaBackend,
  onFinished: ({ meeting, ...result }) => {
    // meeting.json（status = processing）已写入 OPFS；后台收到后把它加入处理队列
    void sendMessage('recordingFinished', { ...result, saved: meeting !== undefined }).catch(
      (e: unknown) => console.error('[huilu] failed to notify background', e),
    )
  },
})

const queue = new ProcessingQueue({
  jobs: new IdbJobStore(),
  source: recordingSource(store),
  // 中间结果放在录制目录里（recordings/<id>/transcript.json …）：不需要授权，数据文件夹失效也不丢
  work: opfs,
  folder: dataFolder,
  // 每一步开始前重新读取：设置变化立即生效，Key 不在离屏文档里长期保存
  services: async () =>
    resolveServices(await sendMessage('processingSettings'), (url) =>
      sendMessage('processingHasHostPermission', url),
    ),
  splitter: createMediabunnySplitter(),
  onChange: async (job) => {
    if (job.state === 'done')
      await sendResultNotification(() => sendMessage('processingCompleted', job.meetingId)).catch(
        (e: unknown) => console.error('[huilu] result notification failed', e),
      )
  },
  onIdle: () => {
    void sendMessage('processingIdle').catch((error: unknown) =>
      console.error('[huilu] idle notification failed', error),
    )
  },
})

/**
 * 恢复上次中断的任务（浏览器重启、离屏文档被关闭）。失败时队列会定时重试；
 * 每次处理请求也会先确保恢复完成：已恢复时只触发队列，未恢复时重新执行恢复
 */
function startQueue() {
  return queue.start().catch((e: unknown) => {
    console.error('[huilu] failed to start the processing queue', e)
  })
}

// 文档创建即恢复
void startQueue()

onMessage('offscreen:start', ({ data }) => controller.start(data))
onMessage('offscreen:pause', () => controller.pause())
onMessage('offscreen:resume', () => controller.resume())
onMessage('offscreen:stop', () => controller.stop())
onMessage('offscreen:status', () => controller.status())
onMessage('offscreen:listUnfinished', () => controller.listUnfinished())
onMessage('offscreen:recover', async ({ data: id }) => (await controller.recover(id)) ?? null)
onMessage('offscreen:discard', ({ data: id }) => controller.discard(id))

onMessage('offscreen:process', async ({ data }) => {
  await startQueue()
  if (!data.meetingId) return null
  return queue.enqueue(data.meetingId, { auto: data.auto })
})
onMessage('offscreen:processingBusy', () => queue.isBusy())
onMessage('offscreen:folderAuthorized', async () => {
  await startQueue()
  await queue.onFolderAuthorized()
})
