import type { Meeting, Summary } from '@huilu/core'
import { timestamp } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { cn } from '@huilu/ui'
import { memo } from 'react'

export const MeetingGuide = memo(function MeetingGuide({
  meeting,
  summary,
  seek,
  current,
  className,
}: {
  className?: string
  meeting: Meeting
  summary?: Summary
  seek: (ms: number) => void
  current: number
}) {
  const { t } = useTranslation()
  return (
    <aside
      className={cn('lg:bg-muted min-w-0 space-y-6 self-start lg:rounded-2xl lg:p-5', className)}
    >
      <h2 className="text-headline font-semibold">{t('result.guide')}</h2>
      {!summary ? (
        <p className="text-muted-foreground text-sm leading-6">{t('result.noSummary')}</p>
      ) : (
        <>
          <section>
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.keywords')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {summary.keywords.map((k, i) => (
                <span
                  key={i}
                  className="bg-primary-soft text-primary text-caption rounded-md px-2 py-1 font-medium"
                >
                  {k}
                </span>
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.overview')}
            </h3>
            <p className="text-muted-foreground max-w-prose text-sm leading-7 whitespace-pre-wrap">
              {summary.overview}
            </p>
          </section>
          <section>
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.chapters')}
            </h3>
            <ol className="space-y-2">
              {summary.chapters.map((c, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seek(c.startMs)}
                    aria-current={current === i ? 'true' : undefined}
                    className={cn(
                      'rounded-control hover:bg-muted lg:hover:bg-surface focus-visible:outline-ring w-full p-3 text-left transition-colors focus-visible:outline-2',
                      current === i && 'bg-muted lg:bg-surface lg:shadow-xs',
                    )}
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
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.speakerSummaries')}
            </h3>
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
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.keyPoints')}
            </h3>
            <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-6">
              {summary.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-muted-foreground text-body2 mb-2.5 font-medium">
              {t('result.actions')}
            </h3>
            <ul className="space-y-3">
              {summary.actionItems.map((a, i) => (
                <li key={i} className="border-accent-500 border-l-2 pl-3 text-sm leading-6">
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
