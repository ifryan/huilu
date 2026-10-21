import type { RecordingMode } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import type { VideoFps, VideoResolution } from '@huilu/recorder'
import { Button, fieldClass } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { StartRecordingRequest } from '@/lib/messaging'
import { defaultMeetingTitle, startErrorText } from '@/lib/recording'
import {
  DEFAULT_RECORDING_PREFS,
  recordingModeSetting,
  recordingPrefsSetting,
  type RecordingPrefs,
} from '@/lib/settings'
import { MicrophoneField } from './MicrophoneField'
import { Field, Segmented } from './Segmented'
import { SwitchRow } from './Switch'

/**
 * 网页面板 / 弹窗：录制设置 + 开始记录。设置保存在 chrome.storage，快捷键开始录制时沿用同一套设置。
 * 怎么开始由宿主决定：网页面板可以在点击里直接弹出共享选择框，弹窗交给后台
 */
export function RecordingSetup({
  onStart,
  disabled = false,
}: {
  /** 在点击的同步调用栈里调用；完成表示录制已开始（或已交给选择框），失败的原因由后台记下 */
  onStart: (request: Omit<StartRecordingRequest, 'tabId'>) => Promise<unknown>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RecordingMode>('audio')
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS)
  // 打开弹窗时按当前时间生成默认会议名，可以直接改
  const [title, setTitle] = useState(() => defaultMeetingTitle(new Date()))
  // 正在用哪种方式开始：只在被点的按钮上显示「正在开始…」
  const [starting, setStarting] = useState<RecordingPrefs['sourceSelection']>()
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

  /** 两个开始按钮：选择来源（标签页 / 窗口 / 屏幕），或直接录当前标签页。记下这次的方式，快捷键沿用 */
  const start = (sourceSelection: NonNullable<RecordingPrefs['sourceSelection']>) => {
    if (disabled || !loaded) return
    if (prefs.sourceSelection !== sourceSelection) updatePrefs({ sourceSelection })
    setStarting(sourceSelection)
    setError(undefined)
    // 在点击的同步调用栈里发出：网页面板要直接弹出共享选择框，弹窗选择窗口 / 屏幕时会失去焦点被关闭。
    // 带上界面当前的设置：刚改完设置立刻点开始时，storage 写入可能还没完成。
    // 来源声音始终录制，麦克风始终用系统默认设备：界面不提供这两项，旧设置里的值不再生效
    const started = onStart({
      title: title.trim() || defaultMeetingTitle(new Date()),
      settings: {
        mode,
        prefs: { ...prefs, sourceSelection, sourceAudio: true, microphoneDeviceId: undefined },
      },
    })
    started
      .then(() => queryClient.invalidateQueries({ queryKey: ['recorderStatus'] }))
      .catch(async (e: unknown) => {
        // 其他失败原因由后台记下，顶部的「最近一次」提示统一显示；「已有录制」不记，就地提示
        await queryClient.invalidateQueries({ queryKey: ['recorderStatus'] })
        if (String(e instanceof Error ? e.name + e.message : e).includes('RecorderBusyError')) {
          setError(t('sidepanel.startFailed', { error: startErrorText(t, e) }))
        }
      })
      .finally(() => setStarting(undefined))
  }

  const quality = prefs.quality

  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label={t('popup.recordVideo')}
        checked={mode === 'video'}
        onChange={(video) => selectMode(video ? 'video' : 'audio')}
      />

      <MicrophoneField
        enabled={prefs.microphone}
        onChange={(enabled) => updatePrefs({ microphone: enabled })}
      />

      <Field label={t('popup.meetingTitle')}>
        <input
          className={fieldClass}
          aria-label={t('popup.meetingTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      {/* 画质只对录制画面有效，默认值够用，收在高级选项里 */}
      {mode === 'video' && (
        <details className="group rounded-control border-border border px-3 py-2">
          <summary className="text-body2 focus-visible:ring-primary cursor-pointer rounded-sm font-medium focus-visible:ring-2">
            {t('popup.advanced')}
            <span className="text-caption text-muted-foreground ml-2 font-normal">
              {quality.resolution} / {quality.fps}fps
            </span>
          </summary>
          <div className="mt-3">
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
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="text-danger text-body2">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="lg"
          variant="outline"
          className="px-2"
          disabled={starting !== undefined || !loaded || disabled}
          onClick={() => start('current-tab')}
        >
          {starting === 'current-tab' ? t('popup.starting') : t('popup.recordCurrentTab')}
        </Button>
        <Button
          size="lg"
          className="px-2"
          disabled={starting !== undefined || !loaded || disabled}
          onClick={() => start('choose')}
        >
          {starting === 'choose' ? t('popup.starting') : t('popup.chooseAndStart')}
        </Button>
      </div>
      <span className="text-muted-foreground text-caption -mt-2 text-center">
        {t('popup.shortcut')}
      </span>
    </div>
  )
}
