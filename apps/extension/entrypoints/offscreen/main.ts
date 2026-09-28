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
  onIdle: () => {
    void sendMessage('processingIdle').catch(() => {})
  },
})

// 文档创建即恢复上次中断的任务（浏览器重启、离屏文档被关闭）
const started = queue.start().catch((e: unknown) => {
  console.error('[huilu] failed to start the processing queue', e)
})

onMessage('offscreen:start', ({ data }) => controller.start(data))
onMessage('offscreen:pause', () => controller.pause())
onMessage('offscreen:resume', () => controller.resume())
onMessage('offscreen:stop', () => controller.stop())
onMessage('offscreen:status', () => controller.status())
onMessage('offscreen:listUnfinished', () => controller.listUnfinished())
onMessage('offscreen:recover', async ({ data: id }) => (await controller.recover(id)) ?? null)
onMessage('offscreen:discard', ({ data: id }) => controller.discard(id))

onMessage('offscreen:process', async ({ data }) => {
  await started
  if (!data.meetingId) {
    queue.kick()
    return null
  }
  return queue.enqueue(data.meetingId, { auto: data.auto })
})
onMessage('offscreen:processingBusy', () => queue.isBusy())
onMessage('offscreen:folderAuthorized', () => queue.onFolderAuthorized())
