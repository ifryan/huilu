import {
  mappedSummary,
  mappedTranscript,
  resolveSpeaker,
  type Meeting,
  type Transcript,
} from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import { EditConflictError, type MeetingEdit } from '@huilu/storage'
import { ArrowLeft, Button, ChevronDown, Star, cn, fieldClass } from '@huilu/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TranscriptRows } from '@/components/TranscriptRows'
import { MeetingExports } from '@/components/MeetingExports'
import { MeetingGuide } from '@/components/MeetingGuide'
import { MeetingPlayer, type PlayerControl } from '@/components/MeetingPlayer'
import { ProcessingStatus } from '@/components/ProcessingStatus'
import {
  loadResult,
  meetingLibraryKey,
  resultMedia,
  resultMediaInfo,
  saveResultEdit,
  type ResultDocument,
} from '@/lib/meeting-library'
import { useProcessingJobs } from '@/lib/processing-jobs'
import { processingReadiness } from '@/lib/processing-view'
import { useReadiness } from '@/lib/readiness'

const emptySegments: Transcript['segments'] = []

export function ResultPage() {
  const { meetingId } = useParams({ strict: false })
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => loadResult(meetingId!),
    enabled: !!meetingId,
    retry: false,
  })
  const { data: jobs } = useProcessingJobs()
  const readiness = processingReadiness(useReadiness().data)
  const job = meetingId ? jobs?.get(meetingId) : undefined
  const client = useQueryClient()
  useEffect(() => {
    if (job?.state === 'done') void client.invalidateQueries({ queryKey: ['meeting', meetingId] })
  }, [client, job?.state, meetingId])
  if (query.isPending) return <p className="text-muted-foreground">{t('result.loading')}</p>
  if (query.error || !query.data)
    return (
      <section className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            {t('nav.history')}
          </Link>
        </Button>
        <h1 className="text-title2 font-semibold">{t('result.unavailable')}</h1>
        <p className="text-muted-foreground">{t('result.unavailableHint')}</p>
        <div className="flex gap-2">
          <Button onClick={() => void query.refetch()}>{t('history.refresh')}</Button>
          <Button asChild variant="outline">
            <Link to="/settings">{t('nav.settings')}</Link>
          </Button>
        </div>
      </section>
    )
  return (
    <ResultContent
      key={meetingId}
      doc={query.data}
      processing={
        query.data.local ? (
          <ProcessingStatus recording={query.data.local} job={job} readiness={readiness} />
        ) : null
      }
    />
  )
}

function ResultContent({ doc, processing }: { doc: ResultDocument; processing: React.ReactNode }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [time, setTime] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedSpeaker, setSpeaker] = useState('')
  // 窄屏用选项卡在逐字稿与导读之间切换；宽屏两栏同时显示
  const [pane, setPane] = useState<'transcript' | 'guide'>('transcript')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'conflict' | 'empty'>(
    'saved',
  )
  const [media, setMedia] = useState<{ url: string; kind: 'audio' | 'video' }>()
  const [mediaError, setMediaError] = useState(false)
  const control = useRef<PlayerControl | null>(null)
  const meeting = doc.meeting
  const transcript = useMemo(
    () => (doc.transcript ? mappedTranscript(meeting, doc.transcript) : undefined),
    [meeting, doc.transcript],
  )
  const summary = useMemo(
    () => (doc.summary ? mappedSummary(meeting, doc.summary) : undefined),
    [meeting, doc.summary],
  )
  const speakers = useMemo(
    () => meeting.speakers.filter((s) => resolveSpeaker(meeting, s.id) === s.id),
    [meeting],
  )
  const names = useMemo(() => new Map(speakers.map((s) => [s.id, s.name])), [speakers])
  const seek = useCallback((ms: number) => control.current?.seek(ms), [])
  const resolvedSpeaker = resolveSpeaker(meeting, selectedSpeaker)
  const speaker = speakers.some((s) => s.id === resolvedSpeaker) ? resolvedSpeaker : ''
  const previewKind = resultMediaInfo(doc, 'video') ? 'video' : 'audio'
  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    void resultMedia(doc, previewKind)
      .then((blob) => {
        if (cancelled) return
        if (!blob) {
          setMedia(undefined)
          return
        }
        setMediaError(false)
        url = URL.createObjectURL(blob)
        setMedia({ url, kind: previewKind })
      })
      .catch(() => {
        if (!cancelled) {
          setMedia(undefined)
          setMediaError(true)
        }
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // Metadata edits do not reload the media or reset the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.dir, doc.source, doc.root, previewKind])
  const save = async (edit: MeetingEdit) => {
    if ((edit.type === 'title' || edit.type === 'rename') && !edit.value.trim()) {
      setSaveState('empty')
      return false
    }
    setSaveState('saving')
    try {
      const updated = await saveResultEdit(doc, edit)
      client.setQueryData<ResultDocument>(['meeting', meeting.id], (old) =>
        old ? { ...old, meeting: updated } : old,
      )
      await client.invalidateQueries({ queryKey: meetingLibraryKey })
      setSaveState('saved')
      return true
    } catch (e) {
      setSaveState(e instanceof EditConflictError ? 'conflict' : 'error')
      return false
    }
  }
  const segments = transcript?.segments ?? emptySegments
  const active = segments.findLastIndex((s) => s.startMs <= time && s.endMs > time)
  const query = search.trim().toLocaleLowerCase()
  return (
    <article className="mx-auto max-w-[1440px] pb-40 sm:pb-28">
      <header className="border-border mb-6 flex flex-wrap items-start gap-x-3 gap-y-2 border-b pb-5">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground mt-0.5">
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            {t('nav.history')}
          </Link>
        </Button>
        <span className="flex-1 md:hidden" />
        <div className="order-last min-w-48 basis-full md:order-none md:flex-1 md:basis-auto">
          <input
            key={meeting.title}
            aria-label={t('result.title')}
            title={t('result.autoSaveHint')}
            defaultValue={meeting.title}
            readOnly={doc.readOnly}
            maxLength={200}
            className="text-title2 rounded-control hover:bg-muted focus-visible:bg-field w-full bg-transparent px-2 py-1 font-semibold outline-none read-only:hover:bg-transparent"
            onBlur={(e) => {
              if (e.target.value !== meeting.title)
                void save({ type: 'title', value: e.target.value, previous: meeting.title })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <p
            aria-live="polite"
            className={`text-caption px-2 pt-1 ${saveState === 'error' || saveState === 'conflict' || saveState === 'empty' ? 'text-danger' : 'text-muted-foreground'}`}
          >
            {doc.readOnly ? t('result.readOnly') : t(`result.save.${saveState}`)}
          </p>
          {(saveState === 'conflict' || saveState === 'error') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void client.invalidateQueries({ queryKey: ['meeting', meeting.id] })}
            >
              {t('history.refresh')}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={meeting.favorite ? t('result.unfavorite') : t('result.favorite')}
          aria-pressed={meeting.favorite ?? false}
          disabled={doc.readOnly || saveState === 'saving'}
          onClick={() => void save({ type: 'favorite', value: !meeting.favorite })}
        >
          <Star
            aria-hidden="true"
            className={meeting.favorite ? 'fill-amber-400 text-amber-400' : undefined}
          />
        </Button>
        <MeetingExports doc={doc} />
      </header>
      <div className="mb-5">{processing}</div>
      {doc.warnings.length > 0 && (
        <p role="alert" className="text-danger mb-4 text-sm">
          {t('result.damagedText')}
        </p>
      )}
      <div
        role="tablist"
        aria-label={t('result.transcript')}
        className="border-border mb-5 flex gap-1 border-b lg:hidden"
      >
        {(['transcript', 'guide'] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              'text-body focus-visible:outline-ring -mb-px border-b-2 px-2.5 py-2 transition-colors duration-200 focus-visible:outline-2',
              pane === p
                ? 'border-accent-600 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {t(p === 'transcript' ? 'result.transcript' : 'result.guide')}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,1fr)]">
        <section className={cn('min-w-0 space-y-5', pane !== 'transcript' && 'hidden lg:block')}>
          <MeetingPlayer
            media={media}
            meeting={meeting}
            summary={summary}
            onTime={setTime}
            control={control}
          />
          {mediaError && (
            <p role="alert" className="text-danger text-sm">
              {t('result.playbackError')}
            </p>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-headline font-semibold">{t('result.transcript')}</h2>
            <span className="text-muted-foreground text-caption">
              {new Date(meeting.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-40 flex-1">
              <span className="sr-only">{t('result.search')}</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('result.search')}
                className={cn(fieldClass, 'w-full')}
              />
            </label>
            <select
              aria-label={t('result.filterSpeaker')}
              className={cn(fieldClass, 'w-auto max-w-full')}
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
            >
              <option value="">{t('result.allSpeakers')}</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {speakers.length > 0 && (
            <SpeakerEditor
              key={`${meeting.editRevision ?? 0}`}
              meeting={meeting}
              disabled={doc.readOnly || saveState === 'saving'}
              save={save}
            />
          )}
          {!transcript && (
            <p className="text-muted-foreground bg-muted rounded-2xl p-5 text-sm leading-6">
              {t('result.noTranscript')}
            </p>
          )}
          {transcript && segments.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('result.emptyTranscript')}</p>
          )}
          <TranscriptRows
            segments={segments}
            active={active}
            speaker={speaker}
            query={query}
            names={names}
            seek={seek}
          />
        </section>
        <MeetingGuide
          className={pane !== 'guide' ? 'hidden lg:block' : undefined}
          meeting={meeting}
          summary={summary}
          seek={seek}
          current={summary?.chapters.findLastIndex((c) => c.startMs <= time) ?? -1}
        />
      </div>
    </article>
  )
}

function SpeakerEditor({
  meeting,
  disabled,
  save,
}: {
  meeting: Meeting
  disabled: boolean
  save: (edit: MeetingEdit) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const speakers = meeting.speakers.filter((s) => resolveSpeaker(meeting, s.id) === s.id)
  const [from, setFrom] = useState(speakers[0]?.id ?? '')
  const [into, setInto] = useState(speakers[1]?.id ?? '')
  return (
    <details className="group border-border bg-surface dark:bg-muted rounded-2xl border text-sm">
      <summary className="hover:bg-muted flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
        {t('result.manageSpeakers')}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 px-4 pb-4">
        {speakers.map((s) => (
          <label key={s.id} className="flex items-center gap-3">
            <span className="text-muted-foreground w-20 shrink-0 truncate">{s.name}</span>
            <input
              aria-label={`${t('result.renameSpeaker')}: ${s.name}`}
              defaultValue={s.name}
              disabled={disabled}
              maxLength={100}
              className={cn(fieldClass, 'w-full')}
              onBlur={(e) => {
                if (e.target.value !== s.name)
                  void save({ type: 'rename', id: s.id, value: e.target.value, previous: s.name })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </label>
        ))}
        {speakers.length > 1 && (
          <form
            className="border-border space-y-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ type: 'merge', from, into, revision: meeting.editRevision ?? 0 })
            }}
          >
            <p className="text-muted-foreground text-xs">{t('result.mergeHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t('result.mergeFrom')}
                value={from}
                disabled={disabled}
                onChange={(e) => setFrom(e.target.value)}
                className={cn(fieldClass, 'w-auto')}
              >
                {speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select
                aria-label={t('result.mergeInto')}
                value={into}
                disabled={disabled}
                onChange={(e) => setInto(e.target.value)}
                className={cn(fieldClass, 'w-auto')}
              >
                {speakers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                disabled={disabled || from === into}
              >
                {t('result.merge')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  )
}
