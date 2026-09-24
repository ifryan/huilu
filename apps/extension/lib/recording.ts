import type { useTranslation } from '@huilu/i18n'
import type { RecorderWarning } from '@huilu/recorder'
import { useQuery } from '@tanstack/react-query'
import { sendMessage } from './messaging'

type T = ReturnType<typeof useTranslation>['t']

/** 录制状态以离屏文档为准，界面每秒轮询一次（计时、已录大小随之刷新） */
export function useRecorderStatus() {
  return useQuery({
    queryKey: ['recorderStatus'],
    queryFn: () => sendMessage('getRecorderStatus'),
    refetchInterval: 1000,
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
  if (
    text.includes('NotAllowedError') ||
    text.includes('cannot be captured') ||
    text.includes('not been invoked')
  ) {
    return t('recorder.error.permission')
  }
  return error instanceof Error ? error.message : text
}
