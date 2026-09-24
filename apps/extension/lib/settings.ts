import { storage } from '#imports'
import type { RecordingMode, VideoSource } from '@huilu/core'
import type { Locale } from '@huilu/i18n'
import { DEFAULT_VIDEO_QUALITY, type VideoQuality } from '@huilu/recorder'

import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_TRANSCRIPTION_SETTINGS,
  type ProviderSettings,
} from './provider-settings'

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

/** 转写服务：当前选择的服务商 + 各服务商已保存的配置（含 API Key） */
export const transcriptionSetting = storage.defineItem<ProviderSettings>('local:transcription', {
  fallback: DEFAULT_TRANSCRIPTION_SETTINGS,
})

export const llmSetting = storage.defineItem<ProviderSettings>('local:llm', {
  fallback: DEFAULT_LLM_SETTINGS,
})

/**
 * 数据文件夹最近一次选择 / 授权成功的时间。
 * 离屏文档可以 watch 它：变化后检查「待写入」的任务并补写（ADR 0004 第 1 节）。
 */
export const dataFolderAuthorizedSetting = storage.defineItem<{ name: string; at: number } | null>(
  'local:dataFolderAuthorized',
  { fallback: null },
)
