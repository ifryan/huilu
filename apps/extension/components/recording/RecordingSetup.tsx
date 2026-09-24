import { browser } from '#imports'
import type { RecordingMode, VideoSource } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import { estimateBytesPerHour, type VideoFps, type VideoResolution } from '@huilu/recorder'
import { Button } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { formatBytes, startErrorText } from '@/lib/recording'
import {
  DEFAULT_RECORDING_PREFS,
  MEETING_LANGUAGES,
  recordingModeSetting,
  recordingPrefsSetting,
  type MeetingLanguage,
  type RecordingPrefs,
} from '@/lib/settings'
import { MicrophoneField } from './MicrophoneField'
import { Field, Segmented } from './Segmented'

const LANGUAGE_KEYS = {
  zh: 'popup.languageZh',
  en: 'popup.languageEn',
  'zh-en': 'popup.languageZhEn',
  auto: 'popup.languageAuto',
} as const satisfies Record<MeetingLanguage, string>

/** 弹窗：录制设置 + 开始记录。设置保存在 chrome.storage，快捷键开始录制时沿用同一套设置。 */
export function RecordingSetup() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RecordingMode>('audio')
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS)
  const [tab, setTab] = useState<{ id?: number; windowId?: number }>({})
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  // 保存的设置读回来之前不能开始：否则界面显示的默认值与实际录制设置可能不一致
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void Promise.all([recordingModeSetting.getValue(), recordingPrefsSetting.getValue()]).then(
      ([savedMode, savedPrefs]) => {
        setMode(savedMode)
        setPrefs(savedPrefs)
        setLoaded(true)
      },
    )
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      setTab({ id: active?.id, windowId: active?.windowId })
      setTitle(active?.title ?? '')
    })
  }, [])

  const selectMode = (next: RecordingMode) => {
    setMode(next)
    void recordingModeSetting.setValue(next)
  }
  const updatePrefs = (patch: Partial<RecordingPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    void recordingPrefsSetting.setValue(next)
  }

  const start = () => {
    if (tab.id === undefined || !loaded) return
    setStarting(true)
    setError(undefined)
    // 两个调用都要在点击的同步调用栈里发出：选择窗口 / 屏幕时弹窗会失去焦点被关闭，
    // 打开侧边栏也要求用户手势
    // 带上界面当前的设置：刚改完设置立刻点开始时，storage 写入可能还没完成
    const started = sendMessage('startRecording', {
      tabId: tab.id,
      title: title.trim() || t('popup.meetingTitlePlaceholder'),
      settings: { mode, prefs },
    })
    if (tab.windowId !== undefined) void browser.sidePanel.open({ windowId: tab.windowId })
    started
      .then(() => queryClient.invalidateQueries({ queryKey: ['recorderStatus'] }))
      .catch((e: unknown) => setError(t('sidepanel.startFailed', { error: startErrorText(t, e) })))
      .finally(() => setStarting(false))
  }

  const quality = prefs.quality
  const perHour = estimateBytesPerHour(mode === 'video' ? quality : null)

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('popup.mode')}>
        <Segmented<RecordingMode>
          value={mode}
          onChange={selectMode}
          options={[
            { value: 'audio', label: t('popup.modeAudio') },
            { value: 'video', label: t('popup.modeVideo') },
          ]}
        />
      </Field>

      <Field label={t('popup.source')}>
        <Segmented<VideoSource>
          value={prefs.videoSource}
          onChange={(videoSource) => updatePrefs({ videoSource })}
          options={[
            { value: 'tab', label: t('popup.sourceTab') },
            { value: 'window', label: t('popup.sourceWindow') },
            { value: 'screen', label: t('popup.sourceScreen') },
          ]}
        />
        {prefs.videoSource !== 'tab' && (
          <span className="text-muted-foreground text-xs">{t('popup.sourceDesktopHint')}</span>
        )}
      </Field>

      {mode === 'video' && (
        <Field label={t('popup.quality')}>
          <div className="grid grid-cols-2 gap-2">
            <Segmented<VideoResolution>
              value={quality.resolution}
              onChange={(resolution) => updatePrefs({ quality: { ...quality, resolution } })}
              options={[
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p' },
              ]}
            />
            <Segmented<VideoFps>
              value={quality.fps}
              onChange={(fps) => updatePrefs({ quality: { ...quality, fps } })}
              options={[
                { value: 15, label: '15fps' },
                { value: 30, label: '30fps' },
              ]}
            />
          </div>
        </Field>
      )}
      <span className="text-muted-foreground -mt-2 text-xs">
        {t('popup.estimate', { size: formatBytes(perHour) })}
      </span>

      <MicrophoneField
        enabled={prefs.microphone}
        deviceId={prefs.microphoneDeviceId}
        onChange={({ enabled, deviceId }) =>
          updatePrefs({ microphone: enabled, microphoneDeviceId: deviceId })
        }
      />

      <Field label={t('popup.language')}>
        <select
          className="border-border bg-background rounded-lg border px-2 py-1.5 text-sm"
          value={prefs.language}
          onChange={(e) => updatePrefs({ language: e.target.value as MeetingLanguage })}
        >
          {MEETING_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {t(LANGUAGE_KEYS[lang])}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('popup.meetingTitle')}>
        <input
          className="border-border bg-background rounded-lg border px-2 py-1.5 text-sm"
          value={title}
          placeholder={t('popup.meetingTitlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      {error && <p className="text-danger text-xs">{error}</p>}
      <Button size="lg" disabled={starting || !loaded || tab.id === undefined} onClick={start}>
        {starting ? t('popup.starting') : t('popup.start')}
      </Button>
      <span className="text-muted-foreground -mt-2 text-center text-xs">{t('popup.shortcut')}</span>
    </div>
  )
}
