import { ProcessingQueue } from '@huilu/pipeline'
import { IdbJobStore } from '@huilu/pipeline/jobs'
import { audioHasSignal, createMediabunnySplitter } from '@huilu/pipeline/mediabunny'
import { RecordingStore } from '@huilu/recorder'
import { recordingSource, resolveServices } from '@/lib/processing'
import { llmSetting, transcriptionSetting, dataFolderAuthorizedSetting } from '@/lib/settings'
import { hasHostPermission } from '@/platform'
import { dataFolder, localResults, opfs } from './storage'
import { WebRecorder } from './recorder'

const store = new RecordingStore(() => navigator.storage.getDirectory())
export const jobs = new IdbJobStore()
const channel = new BroadcastChannel('huilu:web-pipeline')
let leader = false
let busy = false
export let runtimeError: string | undefined
const queue = new ProcessingQueue({
  jobs,
  source: recordingSource(store),
  work: opfs,
  folder: localResults ? opfs : dataFolder,
  folderName: localResults ? (meeting) => meeting.id : undefined,
  services: async () =>
    resolveServices(
      { transcription: await transcriptionSetting.getValue(), llm: await llmSetting.getValue() },
      hasHostPermission,
    ),
  splitter: createMediabunnySplitter(),
  audioHasSignal,
  onChange: () => {
    busy = true
    channel.postMessage({ type: 'changed' })
  },
  onIdle: () => {
    busy = false
    channel.postMessage({ type: 'changed' })
  },
})

// Only one open page may reconcile/run the shared IndexedDB queue. Other pages send commands.
export function startRuntime() {
  void navigator.locks
    .request('huilu:web-pipeline', async () => {
      leader = true
      try {
        await queue.start()
      } catch (error) {
        runtimeError = String(error)
      }
      channel.postMessage({ type: 'leader' })
      await new Promise<void>((resolve) =>
        window.addEventListener(
          'pagehide',
          () => {
            queue.stop()
            leader = false
            resolve()
          },
          { once: true },
        ),
      )
    })
    .catch((error: unknown) => {
      runtimeError = String(error)
    })
  dataFolderAuthorizedSetting.watch(() => {
    void folderAuthorized().catch(console.error)
  })
  window.addEventListener('beforeunload', (event) => {
    if (recorder.status().state !== 'idle' || busy) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}

type Command = { type: 'enqueue'; meetingId: string; auto?: boolean } | { type: 'folder' }
async function execute(command: Command) {
  if (command.type === 'folder') {
    await queue.onFolderAuthorized()
    return null
  }
  const result = await queue.enqueue(command.meetingId, { auto: command.auto })
  busy = await queue.isBusy()
  return result
}
channel.addEventListener('message', (event: MessageEvent) => {
  const data = event.data
  if (data?.type === 'request' && leader) {
    void execute(data.command).then(
      (result) => channel.postMessage({ type: 'reply', id: data.id, result }),
      (error: unknown) => channel.postMessage({ type: 'reply', id: data.id, error: String(error) }),
    )
  }
})
function command(command: Command): Promise<Awaited<ReturnType<typeof execute>>> {
  if (leader) return execute(command)
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timeout = setTimeout(() => {
      channel.removeEventListener('message', response)
      reject(new Error('Processing page did not respond; reopen this page'))
    }, 15000)
    const response = (event: MessageEvent) => {
      if (event.data?.type === 'leader') {
        channel.postMessage({ type: 'request', id, command })
        return
      }
      if (event.data?.type !== 'reply' || event.data.id !== id) return
      clearTimeout(timeout)
      channel.removeEventListener('message', response)
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    channel.addEventListener('message', response)
    channel.postMessage({ type: 'request', id, command })
  })
}
export const processMeeting = async (meetingId: string, auto = false) =>
  (await command({ type: 'enqueue', meetingId, auto }))!
export const folderAuthorized = () => command({ type: 'folder' })
export const recorder = new WebRecorder({
  store,
  onFinished: ({ meeting }) => {
    if (meeting)
      void processMeeting(meeting.id, true).catch((error: unknown) => {
        runtimeError = String(error)
      })
  },
})
