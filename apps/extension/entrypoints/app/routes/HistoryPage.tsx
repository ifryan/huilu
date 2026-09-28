import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ProcessingStatus } from '@/components/ProcessingStatus'
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
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('nav.history')}</h1>
          <p className="text-muted-foreground mt-2 text-sm">{t('library.note')}</p>
        </div>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {t('library.rebuild')}
        </Button>
      </header>
      <input
        type="search"
        aria-label={t('library.search')}
        placeholder={t('library.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border-border bg-background w-full max-w-md rounded-lg border px-3 py-2 text-sm"
      />
      {(data?.folderUnavailable || data?.scanFailed) && (
        <p role="status" className="border-border rounded-lg border p-3 text-sm">
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
      {isLoading && <p className="text-muted-foreground">{t('result.loading')}</p>}
      {!isLoading && items?.length === 0 && (
        <div className="bg-muted text-muted-foreground rounded-xl p-8 text-center text-sm">
          {search ? t('result.noMatches') : t('history.empty')}
        </div>
      )}
      <ul className="space-y-3">
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
              className="border-border flex items-start gap-4 rounded-xl border p-4"
            >
              <Thumbnail item={item} />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {playable ? (
                    <Link
                      to="/meeting/$meetingId"
                      params={{ meetingId: item.id! }}
                      className="hover:text-primary text-base font-medium break-words"
                    >
                      {meeting?.favorite && '★ '}
                      {item.title}
                    </Link>
                  ) : (
                    <h2 className="font-medium break-words">{item.title}</h2>
                  )}
                  {playable && (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/meeting/$meetingId" params={{ meetingId: item.id! }}>
                        {t('library.open')}
                      </Link>
                    </Button>
                  )}
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
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
                  <p className="text-danger text-xs">
                    {item.folder.issue === 'duplicate'
                      ? t('library.duplicate')
                      : t('library.damaged')}
                  </p>
                )}
                {!item.available && (
                  <p className="text-muted-foreground text-xs">{t('library.accessNeeded')}</p>
                )}
                {local ? (
                  <ProcessingStatus
                    recording={{
                      ...local,
                      title: item.title,
                      processing: meeting?.status ?? local.processing,
                    }}
                    job={jobs?.get(local.id)}
                    readiness={readiness}
                  />
                ) : (
                  meeting && (
                    <p className="text-muted-foreground text-xs">
                      {meeting.status === 'ready' ? t('library.ready') : t('library.incomplete')}
                    </p>
                  )
                )}
                {local?.state === 'unfinished' && (
                  <p className="text-muted-foreground text-xs">{t('history.unfinishedHint')}</p>
                )}
                {local?.state === 'damaged' && (
                  <p className="text-danger text-xs">{t('library.damaged')}</p>
                )}
                {local?.state === 'partial' && (
                  <p className="text-muted-foreground text-xs">{t('history.state.partial')}</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
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
      className="bg-muted text-primary hidden h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:flex"
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
        <span className="text-2xl">{video ? '▷' : '▂▅▃▆▂'}</span>
      )}
    </div>
  )
}
