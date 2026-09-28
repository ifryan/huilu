import { useTranslation } from '@huilu/i18n'
import type { ProcessingJob } from '@huilu/pipeline/jobs'
import type { LocalRecording } from '@huilu/recorder'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { ProcessingStatus } from '@/components/ProcessingStatus'
import { StatusPill } from '@/components/Section'
import { openRecordingMedia, useLocalRecordings } from '@/lib/library'
import { useProcessingJobs } from '@/lib/processing-jobs'
import { processingReadiness, type ProcessingReadiness } from '@/lib/processing-view'
import { useReadiness } from '@/lib/readiness'
import { formatBytes, formatDuration } from '@/lib/recording'

/**
 * 最小历史列表：直接读 OPFS 中的录制（不依赖转写服务或数据文件夹），可本地预览和下载，
 * 并显示会后处理（转写 → 纪要 → 写入数据文件夹）的状态，未处理的可以「补转写」。
 * 不删除任何录制。完整的结果页、搜索、导出属于后续任务。
 */
export function HistoryPage() {
  const { t } = useTranslation()
  const { data: recordings, isLoading, error, refetch } = useLocalRecordings()
  // 整页只轮询一次任务、订阅一次就绪状态（录制再多也只有一组轮询和设置监听），按行分发
  const { data: jobs } = useProcessingJobs()
  const readiness = processingReadiness(useReadiness().data)

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
          <RecordingItem key={r.id} recording={r} job={jobs?.get(r.id)} readiness={readiness} />
        ))}
      </ul>
    </section>
  )
}

function RecordingItem({
  recording: r,
  job,
  readiness,
}: {
  recording: LocalRecording
  job: ProcessingJob | undefined
  readiness: ProcessingReadiness | undefined
}) {
  const { t } = useTranslation()
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
      <ProcessingStatus recording={r} job={job} readiness={readiness} />
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
