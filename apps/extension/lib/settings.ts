import { storage } from '#imports'
import type { RecordingMode, VideoSource } from '@huilu/core'
import type { Locale } from '@huilu/i18n'
import { DEFAULT_VIDEO_QUALITY, type VideoQuality } from '@huilu/recorder'

/** 用户设置存放在 chrome.storage.local（不写入数据文件夹，避免 API Key 随文件夹泄露） */
export const localeSetting = storage.defineItem<Locale | null>('local:locale', { fallback: null })

export const recordingModeSetting = storage.defineItem<RecordingMode>('local:recordingMode', {
  fallback: 'audio',
})

export const onboardedSetting = storage.defineItem<boolean>('local:onboarded', { fallback: false })

export const MEETING_LANGUAGES = ['zh', 'en', 'zh-en', 'auto'] as const
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number]

/** 弹窗中的录制设置（录制模式单独存放在 recordingModeSetting），下次打开时沿用 */
export interface RecordingPrefs {
  videoSource: VideoSource
  quality: VideoQuality
  microphone: boolean
  /** 未指定时使用系统默认麦克风 */
  microphoneDeviceId?: string
  language: MeetingLanguage
}

export const DEFAULT_RECORDING_PREFS: RecordingPrefs = {
  videoSource: 'tab',
  quality: DEFAULT_VIDEO_QUALITY,
  microphone: true,
  language: 'zh',
}

export const recordingPrefsSetting = storage.defineItem<RecordingPrefs>('local:recordingPrefs', {
  fallback: DEFAULT_RECORDING_PREFS,
})
