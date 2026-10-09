import { useTranslation } from '@huilu/i18n'
import { Button, RefreshCw, Search, cn, fieldClass } from '@huilu/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ProcessingStatus } from '@/components/ProcessingStatus'
import { StatusPill } from '@/components/Section'
import { resultMedia, useMeetingLibrary, type LibraryItem } from '@/lib/meeting-library'
import { openRecordingMedia } from '@/lib/library'
import { useProcessingJobs } from '@/lib/processing-jobs'
import { processingReadiness } from '@/lib/processing-view'
import { useReadiness } from '@/lib/readiness'
import { formatDuration } from '@/lib/recording'

export function HistoryPage() {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch, isFetching } = useMeetingLibrary()
  const { data: jobs } = useProcessingJobs()
  const readiness = processingReadiness(useReadiness().data)
  const [search, setSearch] = useState('')
  const items = data?.items.filter((r) =>
    r.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-5">
      <header>
        <h1 className="text-title2 font-semibold">{t('nav.history')}</h1>
        <p className="text-muted-foreground text-body2 mt-1">{t('library.note')}</p>
      </header>
      {(data?.folderUnavailable || data?.scanFailed) && (
        <p role="status" className="bg-warning-soft rounded-control text-body px-3 py-2">
          {t('library.folderUnavailable')}{' '}
          <Link to="/settings" className="text-primary underline">
            {t('nav.settings')}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger text-sm">
          {t('library.loadError')}
        </p>
      )}
      {/* Board UI 表格容器：工具栏 + 分隔行，窄屏每条记录自然换行为卡片式 */}
      <div className="border-border bg-surface dark:bg-muted shadow-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="text-body mr-auto font-medium tabular-nums">
            {items && t('library.count', { count: items.length })}
          </div>
          <label className="relative w-full sm:w-64">
            <Search
              className="text-subtle-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label={t('library.search')}
              placeholder={t('library.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(fieldClass, 'pl-8')}
            />
          </label>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCw
              className={isFetching ? 'motion-safe:animate-spin' : undefined}
              aria-hidden="true"
            />
            {t('library.rebuild')}
          </Button>
        </div>
        {isLoading && <p className="text-muted-foreground text-body p-6">{t('result.loading')}</p>}
        {!isLoading && items?.length === 0 && (
          <div className="text-muted-foreground text-body p-10 text-center">
            {search ? t('result.noMatches') : t('history.empty')}
          </div>
        )}
        <ul className="divide-border divide-y">
          {items?.map((item) => {
            const meeting = item.meeting
            const local = item.local
            const playable =
              item.available &&
              !!item.id &&
              !item.folder?.issue &&
              (!!item.folder || (local?.state !== 'unfinished' && local?.state !== 'damaged'))
            return (
              <li
                key={item.key}
                className="hover:bg-muted/60 flex items-start gap-4 px-4 py-3.5 transition-colors"
              >
                <Thumbnail item={item} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {playable ? (
                      <Link
                        to="/meeting/$meetingId"
                        params={{ meetingId: item.id! }}
                        className="hover:text-primary text-body font-medium break-words"
                      >
                        {meeting?.favorite && '★ '}
                        {item.title}
                      </Link>
                    ) : (
                      <h2 className="text-body font-medium break-words">{item.title}</h2>
                    )}
                    {!local && meeting && (
                      <StatusPill
                        tone={
                          meeting.status === 'ready'
                            ? 'success'
                            : meeting.status === 'failed'
                              ? 'error'
                              : 'warning'
                        }
                      >
                        {meeting.status === 'ready' ? t('library.ready') : t('library.incomplete')}
                      </StatusPill>
                    )}
                  </div>
                  <div className="text-muted-foreground text-body2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      {meeting
                        ? new Date(meeting.createdAt).toLocaleString()
                        : local?.startedAt
                          ? new Date(local.startedAt).toLocaleString()
                          : ''}
                    </span>
                    <span>{formatDuration(meeting?.durationMs ?? local?.durationMs ?? 0)}</span>
                    <span>
                      {(meeting?.mode ?? local?.mode) === 'video'
                        ? t('popup.modeVideo')
                        : t('popup.modeAudio')}
                    </span>
                    <span>{item.folder ? t('library.inFolder') : t('library.onDevice')}</span>
                  </div>
                  {item.folder?.issue && (
                    <p className="text-danger text-body2">
                      {item.folder.issue === 'duplicate'
                        ? t('library.duplicate')
                        : t('library.damaged')}
                    </p>
                  )}
                  {!item.available && (
                    <p className="text-muted-foreground text-body2">{t('library.accessNeeded')}</p>
                  )}
                  {local && (
                    <ProcessingStatus
                      recording={{
                        ...local,
                        title: item.title,
                        processing: meeting?.status ?? local.processing,
                      }}
                      job={jobs?.get(local.id)}
                      readiness={readiness}
                    />
                  )}
                  {local?.state === 'unfinished' && (
                    <p className="text-muted-foreground text-body2">
                      {t('history.unfinishedHint')}
                    </p>
                  )}
                  {local?.state === 'damaged' && (
                    <p className="text-danger text-body2">{t('library.damaged')}</p>
                  )}
                  {local?.state === 'partial' && (
                    <p className="text-muted-foreground text-body2">{t('history.state.partial')}</p>
                  )}
                </div>
                {playable && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/meeting/$meetingId" params={{ meetingId: item.id! }}>
                      {t('library.open')}
                    </Link>
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function Thumbnail({ item }: { item: LibraryItem }) {
  const host = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string>()
  const video = (item.meeting?.mode ?? item.local?.mode) === 'video'
  useEffect(() => {
    if (!video || !item.available || !item.id) return
    let cancelled = false
    let objectUrl: string | undefined
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      void (async () => {
        const blob = item.folder
          ? await resultMedia(
              {
                meeting: item.meeting!,
                dir: item.folder.dir,
                source: 'folder',
                root: item.root,
                readOnly: false,
                warnings: [],
              },
              'video',
            )
          : (await openRecordingMedia(item.local!))?.blob
        if (cancelled) return
        if (!blob) {
          setSrc(undefined)
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })().catch(() => {})
    })
    if (host.current) observer.observe(host.current)
    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Only replace the preview when its source changes, not on each index refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.available, item.folder?.dir, item.root, video])
  return (
    <div
      ref={host}
      className="bg-muted text-primary hidden h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:flex"
      aria-hidden="true"
    >
      {src ? (
        <video
          src={src}
          muted
          preload="metadata"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = 0.1
          }}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="text-xl">{video ? '▷' : '▂▅▃▆▂'}</span>
      )}
    </div>
  )
}
