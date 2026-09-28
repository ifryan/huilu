import type { Transcript } from '@huilu/core'
import { timestamp } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { memo, useMemo } from 'react'

type Segment = Transcript['segments'][number]

/** Playback ticks within a segment do not rebuild or filter transcript rows. */
export const TranscriptRows = memo(function TranscriptRows({
  segments,
  active,
  speaker,
  query,
  names,
  seek,
}: {
  segments: Segment[]
  active: number
  speaker: string
  query: string
  names: ReadonlyMap<string, string>
  seek: (ms: number) => void
}) {
  const { t } = useTranslation()
  const rows = useMemo(
    () =>
      segments.flatMap((segment, index) =>
        (speaker && segment.speakerId !== speaker) ||
        (query && !segment.text.toLocaleLowerCase().includes(query))
          ? []
          : [{ segment, index }],
      ),
    [segments, speaker, query],
  )
  return (
    <>
      <ol className="space-y-2">
        {rows.map(({ segment, index }) => (
          <TranscriptRow
            key={index}
            segment={segment}
            index={index}
            active={active === index}
            name={names.get(segment.speakerId) ?? segment.speakerId}
            query={query}
            seek={seek}
          />
        ))}
      </ol>
      {segments.length > 0 && rows.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('result.noMatches')}</p>
      )}
    </>
  )
})

const TranscriptRow = memo(function TranscriptRow({
  segment,
  index,
  active,
  name,
  query,
  seek,
}: {
  segment: Segment
  index: number
  active: boolean
  name: string
  query: string
  seek: (ms: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        data-segment={index}
        aria-current={active ? 'true' : undefined}
        className={`hover:bg-muted w-full rounded-xl border p-4 text-left ${active ? 'border-primary bg-muted' : 'border-transparent'}`}
        onClick={() => seek(segment.startMs)}
      >
        <div className="mb-2 flex items-center gap-3">
          <span className="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-full text-xs">
            {name.slice(0, 1)}
          </span>
          <span className="text-sm font-medium">{name}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {timestamp(segment.startMs)}
          </span>
        </div>
        <p className="max-w-prose text-sm leading-7 whitespace-pre-wrap">
          <Highlight text={segment.text} query={query} />
        </p>
      </button>
    </li>
  )
})

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
