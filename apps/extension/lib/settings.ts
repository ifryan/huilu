import { storage } from '#imports'
import type { RecordingMode } from '@huilu/core'
import type { Locale } from '@huilu/i18n'

/** 用户设置存放在 chrome.storage.local（不写入数据文件夹，避免 API Key 随文件夹泄露） */
export const localeSetting = storage.defineItem<Locale | null>('local:locale', { fallback: null })

export const recordingModeSetting = storage.defineItem<RecordingMode>('local:recordingMode', {
  fallback: 'audio',
})

export const onboardedSetting = storage.defineItem<boolean>('local:onboarded', { fallback: false })
