import type { useTranslation } from '@huilu/i18n'
import type { RecorderStatus, RecorderWarning } from '@huilu/recorder'
import { useQuery } from '@tanstack/react-query'
import { checkMessageError, isExtensionContextInvalidated } from './extension-context'
import { sendMessage } from './messaging'

type T = ReturnType<typeof useTranslation>['t']

interface RecorderPollingOptions {
  meterVisible?: boolean
  hiddenFor?: string
}

/** 隐藏 / 收起时只刷新计时和会话变化，展示电平时才加快采样。 */
export function recorderPollInterval(
  status: RecorderStatus | undefined,
  options: RecorderPollingOptions = {},
): number {
  const key = status?.state !== 'idle' ? (status?.session?.id ?? 'busy') : 'idle'
  return status?.state === 'recording' &&
    options.meterVisible !== false &&
    options.hiddenFor !== key
    ? 200
    : 1000
}

/** 录制状态以离屏文档为准；计时每秒刷新，只有可见电平需要更高频率。 */
export function useRecorderStatus(options: RecorderPollingOptions = {}) {
  return useQuery({
    queryKey: ['recorderStatus'],
    queryFn: async () => {
      try {
        return await sendMessage('getRecorderStatus')
      } catch (error) {
        checkMessageError(error)
        throw error
      }
    },
    retry: (count, error) => !isExtensionContextInvalidated(error) && count < 2,
    refetchInterval: (query) => recorderPollInterval(query.state.data, options),
  })
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function warningText(t: T, warning: RecorderWarning): string {
  switch (warning) {
    case 'source-audio-unavailable':
      return t('recorder.warning.sourceAudioUnavailable')
    case 'mic-unavailable':
      return t('recorder.warning.micUnavailable')
    case 'no-audio':
      return t('recorder.warning.noAudio')
    case 'low-storage':
      return t('recorder.warning.lowStorage')
  }
}

/**
 * 开始录制失败的原因（不含「开始录制失败」前缀）。跨消息传递后错误只剩 name / message
 * （后台存下的是「name: message」字符串），所以按名称匹配；未知错误原样显示。
 */
export function startErrorText(t: T, error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (text.includes('RecorderBusyError')) return t('recorder.error.busy')
  if (text.includes('NoAudioSourceError')) return t('recorder.error.noAudio')
  if (text.includes('InsufficientStorageError')) return t('recorder.error.storage')
  if (text.includes('CaptureCancelledError')) return t('recorder.error.cancelled')
  // macOS 没有给 Chrome「屏幕与系统录音」权限时，取流报 NotAllowedError: Permission denied by system
  if (text.includes('Permission denied by system')) return t('recorder.error.systemPermission')
  if (text.includes('CaptureFailedError')) {
    return t('recorder.error.captureFailed', {
      detail: text.replace(/^.*CaptureFailedError:\s*/, ''),
    })
  }
  if (text.includes('RecorderWindowClosed')) return t('recorder.error.windowClosed')
  if (
    text.includes('NotAllowedError') ||
    text.includes('cannot be captured') ||
    text.includes('not been invoked')
  ) {
    return t('recorder.error.permission')
  }
  return error instanceof Error ? error.message : text
}
