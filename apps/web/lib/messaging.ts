import type { EnqueueResult } from '@huilu/pipeline/jobs'
import type { RecorderStatus, UnfinishedRecording } from '@huilu/recorder'
import { recorder, processMeeting } from '@/platform/runtime'
import { acquireRecordingLease } from '@/platform/recorder'
export type { RecorderStatus, UnfinishedRecording }
export type LastRecording = NonNullable<RecorderStatus['lastResult']>
interface Protocol {
  getRecorderStatus: [undefined, RecorderStatus]
  pauseRecording: [undefined, RecorderStatus]
  resumeRecording: [undefined, RecorderStatus]
  stopRecording: [undefined, RecorderStatus]
  listUnfinishedRecordings: [undefined, UnfinishedRecording[]]
  recoverRecording: [string, { saved: boolean }]
  discardRecording: [string, void]
  processMeeting: [string, EnqueueResult]
  openApp: [string, void]
}
export async function sendMessage<K extends keyof Protocol>(
  type: K,
  ...args: Protocol[K][0] extends undefined ? [] : [Protocol[K][0]]
): Promise<Protocol[K][1]> {
  const id = args[0] as string
  const controller = recorder.controller
  let result: unknown
  switch (type) {
    case 'getRecorderStatus':
      result = recorder.status()
      break
    case 'pauseRecording':
      result = controller.pause()
      break
    case 'resumeRecording':
      result = controller.resume()
      break
    case 'stopRecording':
      result = await controller.stop()
      break
    case 'processMeeting':
      result = await processMeeting(id)
      break
    case 'openApp':
      window.location.hash = id
      break
    case 'listUnfinishedRecordings':
      result = await navigator.locks.request(
        'huilu:web-recording',
        { ifAvailable: true },
        (lock) => (lock ? controller.listUnfinished() : []),
      )
      break
    case 'recoverRecording': {
      const release = await acquireRecordingLease()
      try {
        const meeting = await controller.recover(id)
        if (meeting) await processMeeting(meeting.id, true)
        result = { saved: !!meeting }
      } finally {
        release()
      }
      break
    }
    case 'discardRecording': {
      const release = await acquireRecordingLease()
      try {
        await controller.discard(id)
      } finally {
        release()
      }
      break
    }
  }
  return result as Protocol[K][1]
}
