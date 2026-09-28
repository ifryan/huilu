import { mappedSummary, mappedTranscript, resolveSpeaker, type Meeting } from '@huilu/core'
import { timestamp } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { EditConflictError, type MeetingEdit } from '@huilu/storage'
import { Button } from '@huilu/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { MeetingExports } from '@/components/MeetingExports'
import { MeetingGuide } from '@/components/MeetingGuide'
import { MeetingPlayer, type PlayerControl } from '@/components/MeetingPlayer'
import { ProcessingStatus } from '@/components/ProcessingStatus'
import {
  loadResult,
  meetingLibraryKey,
  resultMedia,
  saveResultEdit,
  type ResultDocument,
} from '@/lib/meeting-library'
import { useProcessingJobs } from '@/lib/processing-jobs'
import { processingReadiness } from '@/lib/processing-view'
import { useReadiness } from '@/lib/readiness'

const fieldClass =
  'border-border bg-background focus:border-primary rounded-lg border px-3 py-2 text-sm'

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
        <Link to="/" className="text-primary">
          ← {t('nav.history')}
        </Link>
        <h1 className="text-xl font-semibold">{t('result.unavailable')}</h1>
        <p className="text-muted-foreground">{t('result.unavailableHint')}</p>
        <Button onClick={() => void query.refetch()}>{t('history.refresh')}</Button>
        <Button asChild variant="outline">
          <Link to="/settings">{t('nav.settings')}</Link>
        </Button>
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
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'conflict' | 'empty'>(
    'saved',
  )
  const [media, setMedia] = useState<{ url: string; kind: 'audio' | 'video' }>()
  const [mediaError, setMediaError] = useState(false)
  const control = useRef<PlayerControl | null>(null)
  const meeting = doc.meeting
  const transcript = doc.transcript ? mappedTranscript(meeting, doc.transcript) : undefined
  const summary = doc.summary ? mappedSummary(meeting, doc.summary) : undefined
  const speakers = meeting.speakers.filter((s) => resolveSpeaker(meeting, s.id) === s.id)
  const resolvedSpeaker = resolveSpeaker(meeting, selectedSpeaker)
  const speaker = speakers.some((s) => s.id === resolvedSpeaker) ? resolvedSpeaker : ''
  const previewKind = meeting.media?.video ? 'video' : 'audio'
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
  const segments = transcript?.segments ?? []
  const active = segments.findLastIndex((s) => s.startMs <= time && s.endMs > time)
  const query = search.trim().toLocaleLowerCase()
  return (
    <article className="mx-auto max-w-[1440px] pb-28">
      <header className="border-border mb-6 flex flex-wrap items-start gap-4 border-b pb-5">
        <Link to="/" className="text-muted-foreground hover:bg-muted rounded-lg px-2 py-2 text-sm">
          ← {t('nav.history')}
        </Link>
        <div className="min-w-48 flex-1">
          <input
            key={meeting.title}
            aria-label={t('result.title')}
            title={t('result.autoSaveHint')}
            defaultValue={meeting.title}
            readOnly={doc.readOnly}
            maxLength={200}
            className="focus:border-primary w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold"
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
            className={`px-2 pt-1 text-xs ${saveState === 'error' || saveState === 'conflict' || saveState === 'empty' ? 'text-danger' : 'text-muted-foreground'}`}
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
          aria-label={meeting.favorite ? t('result.unfavorite') : t('result.favorite')}
          aria-pressed={meeting.favorite ?? false}
          disabled={doc.readOnly || saveState === 'saving'}
          onClick={() => void save({ type: 'favorite', value: !meeting.favorite })}
        >
          {meeting.favorite ? '★' : '☆'}
        </Button>
        <MeetingExports doc={doc} />
      </header>
      <div className="mb-5">{processing}</div>
      {doc.warnings.length > 0 && (
        <p role="alert" className="text-danger mb-4 text-sm">
          {t('result.damagedText')}
        </p>
      )}
      <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,1fr)]">
        <section className="min-w-0 space-y-5">
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
            <h2 className="text-lg font-semibold">{t('result.transcript')}</h2>
            <span className="text-muted-foreground text-xs">
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
                className={`${fieldClass} w-full`}
              />
            </label>
            <select
              aria-label={t('result.filterSpeaker')}
              className={`${fieldClass} w-auto`}
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
            <p className="text-muted-foreground bg-muted rounded-xl p-5 text-sm leading-6">
              {t('result.noTranscript')}
            </p>
          )}
          {transcript && segments.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('result.emptyTranscript')}</p>
          )}
          <ol className="space-y-2">
            {segments.map((s, i) => {
              if (
                (speaker && s.speakerId !== speaker) ||
                (query && !s.text.toLocaleLowerCase().includes(query))
              )
                return null
              return (
                <li key={i}>
                  <button
                    type="button"
                    data-segment={i}
                    aria-current={active === i ? 'true' : undefined}
                    className={`hover:bg-muted w-full rounded-xl border p-4 text-left ${active === i ? 'border-primary bg-muted' : 'border-transparent'}`}
                    onClick={() => control.current?.seek(s.startMs)}
                  >
                    <div className="mb-2 flex items-center gap-3">
                      <span className="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-full text-xs">
                        {(speakers.find((p) => p.id === s.speakerId)?.name ?? s.speakerId).slice(
                          0,
                          1,
                        )}
                      </span>
                      <span className="text-sm font-medium">
                        {speakers.find((p) => p.id === s.speakerId)?.name ?? s.speakerId}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {timestamp(s.startMs)}
                      </span>
                    </div>
                    <p className="max-w-prose text-sm leading-7 whitespace-pre-wrap">
                      <Highlight text={s.text} query={query} />
                    </p>
                  </button>
                </li>
              )
            })}
          </ol>
          {segments.length > 0 &&
            !segments.some(
              (s) =>
                (!speaker || s.speakerId === speaker) &&
                (!query || s.text.toLocaleLowerCase().includes(query)),
            ) && <p className="text-muted-foreground text-sm">{t('result.noMatches')}</p>}
        </section>
        <MeetingGuide
          meeting={meeting}
          summary={summary}
          seek={(ms) => control.current?.seek(ms)}
          time={time}
        />
      </div>
    </article>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text
  const out: React.ReactNode[] = []
  const lower = text.toLocaleLowerCase()
  let start = 0
  let found = lower.indexOf(query)
  while (found >= 0) {
    out.push(
      text.slice(start, found),
      <mark key={found} className="rounded-sm bg-yellow-200 text-neutral-900">
        {text.slice(found, found + query.length)}
      </mark>,
    )
    start = found + query.length
    found = lower.indexOf(query, start)
  }
  out.push(text.slice(start))
  return out
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
    <details className="border-border rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t('result.manageSpeakers')}</summary>
      <div className="mt-3 space-y-3">
        {speakers.map((s) => (
          <label key={s.id} className="flex items-center gap-3">
            <span className="text-muted-foreground w-20 shrink-0 truncate">{s.name}</span>
            <input
              aria-label={`${t('result.renameSpeaker')}: ${s.name}`}
              defaultValue={s.name}
              disabled={disabled}
              maxLength={100}
              className={`${fieldClass} w-full`}
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
                className={`${fieldClass} w-auto`}
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
                className={`${fieldClass} w-auto`}
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
