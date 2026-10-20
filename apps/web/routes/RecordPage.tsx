import type { RecordingMode } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import type { VideoFps, VideoResolution } from '@huilu/recorder'
import { Button, fieldClass } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  RecordingStatusCard,
  LastRecordingNotice,
} from '@huilu/app-shell/components/recording/RecordingStatusCard'
import { UnfinishedRecordings } from '@huilu/app-shell/components/recording/UnfinishedRecordings'
import { SwitchRow } from '@huilu/app-shell/components/recording/Switch'
import { Field, Segmented } from '@huilu/app-shell/components/recording/Segmented'
import { defaultMeetingTitle, startErrorText, useRecorderStatus } from '@/lib/recording'
import {
  DEFAULT_RECORDING_PREFS,
  MEETING_LANGUAGES,
  recordingModeSetting,
  recordingPrefsSetting,
  type RecordingPrefs,
} from '@/lib/settings'
import { recorder } from '@/platform/runtime'
import { documentPip, useRecordingWindow } from '@/platform/pip'
export function RecordPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const { data: status } = useRecorderStatus()
  const [mode, setMode] = useState<RecordingMode>('audio')
  const [prefs, setPrefs] = useState<RecordingPrefs>(DEFAULT_RECORDING_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState(() => defaultMeetingTitle(new Date()))
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const active = starting || (status && status.state !== 'idle')
  const pip = useRecordingWindow(!!active)
  useEffect(() => {
    void Promise.all([recordingModeSetting.getValue(), recordingPrefsSetting.getValue()])
      .then(([mode, prefs]) => {
        setMode(mode)
        setPrefs({ ...DEFAULT_RECORDING_PREFS, ...prefs })
        setLoaded(true)
      })
      .catch((error: unknown) => setError(String(error)))
  }, [])
  const update = (patch: Partial<RecordingPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    void recordingPrefsSetting.setValue(next).catch((error: unknown) => setError(String(error)))
  }
  const start = () => {
    setStarting(true)
    setError(undefined)
    void recorder
      .start({
        title: title.trim() || defaultMeetingTitle(new Date()),
        mode,
        quality: prefs.quality,
        sourceAudio: prefs.sourceAudio !== false,
        microphone: { enabled: prefs.microphone, deviceId: prefs.microphoneDeviceId },
        language: prefs.language,
      })
      .catch((error: unknown) => setError(startErrorText(t, error)))
      .finally(() => {
        setStarting(false)
        void client.invalidateQueries({ queryKey: ['recorderStatus'] })
      })
  }
  const refreshDevices = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === 'audioinput',
        ),
      )
    } catch (error) {
      setError(String(error))
    }
  }
  const captureSupported =
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  const controls = status?.session ? <RecordingStatusCard status={status} /> : null
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-5">
      <header>
        <h1 className="text-title2 font-semibold">{t('web.record')}</h1>
        <p className="text-muted-foreground text-body2 mt-1">{t('web.sourceHint')}</p>
      </header>
      {active ? (
        <>
          {controls}
          {!status?.session && <p role="status">{t('popup.starting')}</p>}
          {documentPip ? (
            <Button
              variant="outline"
              className="self-start"
              onClick={() =>
                void pip
                  .open()
                  .catch((error: unknown) => setError(t('web.pipError') + String(error)))
              }
            >
              {t('web.pip')}
            </Button>
          ) : (
            <p className="text-body2 text-muted-foreground">{t('web.pipUnsupported')}</p>
          )}
        </>
      ) : (
        <>
          {status?.lastResult && <LastRecordingNotice result={status.lastResult} />}
          <div className="border-border bg-surface shadow-card flex flex-col gap-5 rounded-2xl border p-5">
            <Field label={t('popup.meetingTitle')}>
              <input
                className={fieldClass}
                aria-label={t('popup.meetingTitle')}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <SwitchRow
              label={t('popup.recordVideo')}
              checked={mode === 'video'}
              onChange={(value) => {
                const mode = value ? 'video' : 'audio'
                setMode(mode)
                void recordingModeSetting
                  .setValue(mode)
                  .catch((error: unknown) => setError(String(error)))
              }}
            />
            <SwitchRow
              label={t('web.sourceAudio')}
              checked={prefs.sourceAudio !== false}
              onChange={(sourceAudio) => update({ sourceAudio })}
            />
            <SwitchRow
              label={t('popup.microphone')}
              checked={prefs.microphone}
              onChange={(microphone) => update({ microphone })}
            />
            {prefs.microphone && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-body min-w-48 flex-1">
                  {t('web.micDevice')}
                  <select
                    className={fieldClass}
                    value={prefs.microphoneDeviceId ?? ''}
                    onChange={(e) => update({ microphoneDeviceId: e.target.value || undefined })}
                  >
                    <option value="">{t('web.defaultDevice')}</option>
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || device.deviceId}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="outline" onClick={() => void refreshDevices()}>
                  {t('web.devices')}
                </Button>
              </div>
            )}
            {mode === 'video' && (
              <Field label={t('popup.quality')}>
                <div className="grid grid-cols-2 gap-3">
                  <Segmented<VideoResolution>
                    value={prefs.quality.resolution}
                    onChange={(resolution) => update({ quality: { ...prefs.quality, resolution } })}
                    options={[
                      { value: '720p', label: '720p' },
                      { value: '1080p', label: '1080p' },
                    ]}
                  />
                  <Segmented<VideoFps>
                    value={prefs.quality.fps}
                    onChange={(fps) => update({ quality: { ...prefs.quality, fps } })}
                    options={[
                      { value: 15, label: '15fps' },
                      { value: 30, label: '30fps' },
                    ]}
                  />
                </div>
              </Field>
            )}
            <label className="text-body flex flex-col gap-1">
              {t('popup.language')}
              <select
                className={fieldClass}
                value={prefs.language}
                onChange={(e) => update({ language: e.target.value as RecordingPrefs['language'] })}
              >
                {MEETING_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {t(
                      language === 'zh'
                        ? 'popup.languageZh'
                        : language === 'en'
                          ? 'popup.languageEn'
                          : language === 'zh-en'
                            ? 'popup.languageZhEn'
                            : 'popup.languageAuto',
                    )}
                  </option>
                ))}
              </select>
            </label>
            <Button size="lg" disabled={!loaded || !captureSupported} onClick={start}>
              {t('web.start')}
            </Button>
          </div>
          <UnfinishedRecordings />
        </>
      )}
      {!captureSupported && (
        <p role="status" className="text-warning text-body">
          {t('web.captureUnsupported')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-body break-words">
          {error}
        </p>
      )}
      {pip.render(controls)}
    </section>
  )
}
