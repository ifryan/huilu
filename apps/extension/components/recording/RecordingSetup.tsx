import { browser } from '#imports'
import type { RecordingMode } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import { estimateBytesPerHour, type VideoFps, type VideoResolution } from '@huilu/recorder'
import { Button, fieldClass } from '@huilu/ui'
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
export function RecordingSetup({
  onStarted,
}: {
  /** 开始成功；panelShown 为 false 表示当前页面不能显示悬浮面板 */
  onStarted?: (panelShown: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RecordingMode>('audio')
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS)
  const [tab, setTab] = useState<{ id?: number }>({})
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  // 保存的设置读回来之前不能开始：否则界面显示的默认值与实际录制设置可能不一致
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void Promise.all([recordingModeSetting.getValue(), recordingPrefsSetting.getValue()]).then(
      ([savedMode, savedPrefs]) => {
        setMode(savedMode)
        setPrefs({ ...savedPrefs, sourceSelection: savedPrefs.sourceSelection ?? 'choose' })
        setLoaded(true)
      },
    )
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      setTab({ id: active?.id })
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
    // 在点击的同步调用栈里发出：选择窗口 / 屏幕时弹窗会失去焦点被关闭。
    // 带上界面当前的设置：刚改完设置立刻点开始时，storage 写入可能还没完成
    const started = sendMessage('startRecording', {
      tabId: tab.id,
      title: title.trim() || t('popup.meetingTitlePlaceholder'),
      settings: { mode, prefs },
    })
    started
      .then(async ({ panelShown }) => {
        await queryClient.invalidateQueries({ queryKey: ['recorderStatus'] })
        onStarted?.(panelShown)
        // 录制已开始：进度与控制都在页面内悬浮面板，弹窗不再重复显示；
        // 面板显示不了（如 chrome:// 页面）就保留弹窗，在这里控制
        if (panelShown) window.close()
      })
      .catch(async (e: unknown) => {
        // 其他失败原因由后台记下，弹窗顶部的「最近一次」提示统一显示；「已有录制」不记，就地提示
        await queryClient.invalidateQueries({ queryKey: ['recorderStatus'] })
        if (String(e instanceof Error ? e.name + e.message : e).includes('RecorderBusyError')) {
          setError(t('sidepanel.startFailed', { error: startErrorText(t, e) }))
        }
      })
      .finally(() => setStarting(false))
  }

  const quality = prefs.quality
  const perHour = estimateBytesPerHour(mode === 'video' ? quality : null)

  return (
    <div className="flex flex-col gap-3">
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

      <label className="text-body flex flex-col gap-1">
        <span className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={prefs.sourceAudio !== false}
            className="size-4"
            onChange={(e) => updatePrefs({ sourceAudio: e.target.checked })}
          />
          {t('popup.sourceAudioShort')}
        </span>
      </label>

      <MicrophoneField
        compact
        enabled={prefs.microphone}
        deviceId={prefs.microphoneDeviceId}
        onChange={({ enabled, deviceId }) =>
          updatePrefs({ microphone: enabled, microphoneDeviceId: deviceId })
        }
      />

      <details className="group rounded-control border-border border px-3 py-2">
        <summary className="text-body2 focus-visible:ring-primary cursor-pointer rounded-sm font-medium focus-visible:ring-2">
          {t('popup.moreSettings')}
          <span className="text-caption text-muted-foreground ml-2 font-normal">
            {t(LANGUAGE_KEYS[prefs.language])}
            {mode === 'video' ? ` · ${quality.resolution} / ${quality.fps}fps` : ''}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
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
          <span className="text-muted-foreground text-caption -mt-2">
            {t('popup.estimate', { size: formatBytes(perHour) })}
          </span>

          <Field label={t('popup.language')}>
            <select
              className={fieldClass}
              aria-label={t('popup.language')}
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
              className={fieldClass}
              aria-label={t('popup.meetingTitle')}
              value={title}
              placeholder={t('popup.meetingTitlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <label className="text-body2 flex items-start gap-2">
            <input
              type="checkbox"
              className="accent-primary mt-0.5 size-4 shrink-0"
              checked={prefs.sourceSelection === 'current-tab'}
              onChange={(event) =>
                updatePrefs({ sourceSelection: event.target.checked ? 'current-tab' : 'choose' })
              }
            />
            {t('popup.quickCurrentTab')}
          </label>
        </div>
      </details>

      <p className="text-muted-foreground text-caption">
        {t(
          prefs.sourceSelection === 'current-tab'
            ? 'popup.quickCurrentTabHint'
            : 'popup.chooseSourceHint',
        )}
      </p>

      {error && (
        <p role="alert" className="text-danger text-body2">
          {error}
        </p>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={starting || !loaded || tab.id === undefined}
        onClick={start}
      >
        {starting
          ? t('popup.starting')
          : t(prefs.sourceSelection === 'current-tab' ? 'popup.start' : 'popup.chooseAndStart')}
      </Button>
      <span className="text-muted-foreground text-caption -mt-2 text-center">
        {t('popup.shortcut')}
      </span>
    </div>
  )
}
