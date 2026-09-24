import { useTranslation } from '@huilu/i18n'
import type { LocalRecording } from '@huilu/recorder'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { StatusPill } from '@/components/Section'
import { openRecordingMedia, useLocalRecordings } from '@/lib/library'
import { useReadiness } from '@/lib/readiness'
import { formatBytes, formatDuration } from '@/lib/recording'

/**
 * 最小历史列表：直接读 OPFS 中的录制（不依赖转写服务或数据文件夹），可本地预览和下载。
 * 只读：不删除、不改写任何录制。完整的结果页、搜索、导出属于后续任务。
 */
export function HistoryPage() {
  const { t } = useTranslation()
  const { data: recordings, isLoading, error, refetch } = useLocalRecordings()

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('nav.history')}</h1>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('history.refresh')}
        </Button>
      </header>
      <p className="text-muted-foreground text-sm">{t('history.localNote')}</p>
      {error && <p className="text-danger text-sm">{String(error)}</p>}
      {!isLoading && recordings?.length === 0 && (
        <p className="text-muted-foreground">{t('history.empty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {recordings?.map((r) => (
          <RecordingItem key={r.id} recording={r} />
        ))}
      </ul>
    </section>
  )
}

function RecordingItem({ recording: r }: { recording: LocalRecording }) {
  const { t } = useTranslation()
  const { data: readiness } = useReadiness()
  const [media, setMedia] = useState<{ url: string; kind: 'video' | 'audio' }>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => () => media && URL.revokeObjectURL(media.url), [media])

  const stateText = {
    saved: t('history.state.saved'),
    partial: t('history.state.partial'),
    unfinished: t('history.state.unfinished'),
    damaged: t('history.state.damaged'),
  }[r.state]

  const preview = async () => {
    setFailed(undefined)
    const opened = await openRecordingMedia(r).catch((e: unknown) => {
      setFailed(String(e))
      return undefined
    })
    if (opened) setMedia({ url: URL.createObjectURL(opened.blob), kind: opened.kind })
    else setFailed((f) => f ?? t('history.noMedia'))
  }
  const download = async () => {
    const opened = await openRecordingMedia(r)
    if (!opened) return setFailed(t('history.noMedia'))
    const url = URL.createObjectURL(opened.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = opened.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const transcribed = r.processing === 'ready'
  return (
    <li className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{r.title}</div>
        <StatusPill ok={r.state === 'saved'}>{stateText}</StatusPill>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
        {r.startedAt !== undefined && <span>{new Date(r.startedAt).toLocaleString()}</span>}
        <span>{formatDuration(r.durationMs)}</span>
        <span>{formatBytes(r.bytes)}</span>
        {r.mode && <span>{r.mode === 'video' ? t('popup.modeVideo') : t('popup.modeAudio')}</span>}
        <span>{t('history.location')}</span>
      </div>
      {r.state !== 'damaged' && r.state !== 'unfinished' && (
        <div className="text-xs">
          {transcribed
            ? t('history.transcribed')
            : !r.transcribable
              ? t('history.noTranscriptAudio')
              : readiness && !readiness.transcription
                ? t('history.notTranscribedNoService')
                : t('history.notTranscribed')}
        </div>
      )}
      {r.state === 'unfinished' && <p className="text-xs">{t('history.unfinishedHint')}</p>}
      {r.error && <p className="text-danger text-xs break-all">{r.error}</p>}
      {r.state !== 'damaged' && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void preview()}>
            {t('history.preview')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download()}>
            {t('history.download')}
          </Button>
        </div>
      )}
      {failed && <p className="text-danger text-xs">{failed}</p>}
      {media?.kind === 'video' && (
        <video src={media.url} controls className="max-h-80 w-full rounded-lg bg-black" />
      )}
      {media?.kind === 'audio' && <audio src={media.url} controls className="w-full" />}
    </li>
  )
}
