import type { Meeting, Summary } from '@huilu/core'
import { timestamp } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useImperativeHandle, useRef, useState, type RefObject } from 'react'

export interface PlayerControl {
  seek: (ms: number) => void
}
export function MeetingPlayer({
  media,
  meeting,
  summary,
  onTime,
  control,
}: {
  media?: { url: string; kind: 'audio' | 'video' }
  meeting: Meeting
  summary?: Summary
  onTime: (ms: number) => void
  control: RefObject<PlayerControl | null>
}) {
  const { t } = useTranslation()
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState('1')
  const [error, setError] = useState(false)
  const duration = meeting.durationMs
  useImperativeHandle(
    control,
    () => ({
      seek: (ms: number) => {
        if (!element.current) return
        const target = Math.max(0, Math.min(duration, ms)) / 1000
        element.current.currentTime = target
        setTime(target * 1000)
        onTime(target * 1000)
        void element.current.play().catch(() => setError(true))
      },
    }),
    [duration, onTime],
  )
  const seek = (ms: number) => {
    if (!element.current) return
    const target = Math.max(0, Math.min(duration, ms))
    element.current.currentTime = target / 1000
    setTime(target)
    onTime(target)
  }
  const toggle = () => {
    if (!element.current) return
    if (element.current.paused) void element.current.play().catch(() => setError(true))
    else element.current.pause()
  }
  const events = {
    onTimeUpdate: () => {
      const ms = (element.current?.currentTime ?? 0) * 1000
      setTime(ms)
      onTime(ms)
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => setError(true),
    onLoadedMetadata: () => {
      if (element.current) element.current.playbackRate = Number(rate)
    },
  }
  return (
    <>
      <div className="bg-muted overflow-hidden rounded-xl">
        {media?.kind === 'video' ? (
          <video
            ref={element}
            src={media.url}
            controls
            playsInline
            {...events}
            className="max-h-[38vh] w-full bg-black"
          />
        ) : (
          <div className="flex h-44 flex-col items-center justify-center gap-4">
            <div className="text-primary flex h-12 items-center gap-1" aria-hidden="true">
              {Array.from({ length: 45 }, (_, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full bg-current opacity-60"
                  style={{ height: `${8 + Math.sin(i * 1.7) ** 2 * 36}px` }}
                />
              ))}
            </div>
            <span className="text-muted-foreground text-sm">
              {media ? t('popup.modeAudio') : t('history.noMedia')}
            </span>
            {media && <audio ref={element} src={media.url} {...events} />}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {t('result.playbackError')}
        </p>
      )}
      <div className="bg-background border-border fixed inset-x-0 bottom-0 z-20 border-t px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!media}
            aria-label={t('result.back15')}
            onClick={() => seek(time - 15000)}
          >
            −15s
          </Button>
          <Button size="sm" disabled={!media} onClick={toggle}>
            {playing ? t('result.pause') : t('result.play')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!media}
            aria-label={t('result.forward15')}
            onClick={() => seek(time + 15000)}
          >
            +15s
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            {timestamp(time)} / {timestamp(duration)}
          </span>
          <div className="relative min-w-40 flex-1 pb-2">
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={100}
              value={Math.min(time, duration)}
              disabled={!media}
              aria-label={t('result.seek')}
              onChange={(e) => seek(Number(e.target.value))}
              className="accent-primary w-full"
            />
            {summary?.chapters.map((c, i) => (
              <button
                key={i}
                type="button"
                title={`${timestamp(c.startMs)} ${c.title}`}
                aria-label={`${t('result.chapter')}: ${c.title}`}
                onClick={() => control.current?.seek(c.startMs)}
                disabled={!media}
                className="border-background bg-primary absolute bottom-0 h-3 w-3 -translate-x-1/2 rounded-full border-2"
                style={{ left: `${Math.min(100, (c.startMs / Math.max(1, duration)) * 100)}%` }}
              />
            ))}
            {meeting.markers.map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.label ?? t('result.marker')}
                aria-label={m.label ?? t('result.marker')}
                onClick={() => control.current?.seek(m.atMs)}
                disabled={!media}
                className="bg-foreground absolute bottom-0 h-3 w-1"
                style={{ left: `${Math.min(100, (m.atMs / Math.max(1, duration)) * 100)}%` }}
              />
            ))}
          </div>
          <select
            aria-label={t('result.speed')}
            value={rate}
            onChange={(e) => {
              setRate(e.target.value)
              if (element.current) element.current.playbackRate = Number(e.target.value)
            }}
            className="border-border bg-background rounded-lg border px-2 py-2 text-sm"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}
