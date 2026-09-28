import type { Meeting, Summary } from '@huilu/core'
import { timestamp } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { memo } from 'react'

export const MeetingGuide = memo(function MeetingGuide({
  meeting,
  summary,
  seek,
  current,
}: {
  meeting: Meeting
  summary?: Summary
  seek: (ms: number) => void
  current: number
}) {
  const { t } = useTranslation()
  return (
    <aside className="border-border min-w-0 space-y-7 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
      <h2 className="text-lg font-semibold">{t('result.guide')}</h2>
      {!summary ? (
        <p className="text-muted-foreground text-sm leading-6">{t('result.noSummary')}</p>
      ) : (
        <>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.keywords')}</h3>
            <div className="flex flex-wrap gap-2">
              {summary.keywords.map((k, i) => (
                <span key={i} className="bg-muted text-primary rounded-md px-2 py-1 text-xs">
                  {k}
                </span>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.overview')}</h3>
            <p className="text-muted-foreground max-w-prose text-sm leading-7 whitespace-pre-wrap">
              {summary.overview}
            </p>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.chapters')}</h3>
            <ol className="space-y-2">
              {summary.chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seek(c.startMs)}
                    aria-current={current === i ? 'true' : undefined}
                    className={`hover:bg-muted w-full rounded-lg p-3 text-left ${current === i ? 'bg-muted' : ''}`}
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-primary shrink-0 text-xs tabular-nums">
                        {timestamp(c.startMs)}
                      </span>
                      <strong className="text-sm font-medium">{c.title}</strong>
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm leading-6">{c.summary}</p>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.speakerSummaries')}</h3>
            <div className="space-y-4">
              {summary.speakerSummaries.map((s, i) => (
                <div key={i}>
                  <h4 className="text-sm font-medium">
                    {meeting.speakers.find((p) => p.id === s.speakerId)?.name ?? s.speakerId}
                  </h4>
                  <p className="text-muted-foreground mt-1 text-sm leading-6 whitespace-pre-wrap">
                    {s.summary}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.keyPoints')}</h3>
            <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-6">
              {summary.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-3 text-sm font-semibold">{t('result.actions')}</h3>
            <ul className="space-y-3">
              {summary.actionItems.map((a, i) => (
                <li key={i} className="border-border border-l-2 pl-3 text-sm leading-6">
                  <p>{a.text}</p>
                  {(a.owner || a.due) && (
                    <p className="text-muted-foreground text-xs">
                      {[a.owner, a.due].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </aside>
  )
})
