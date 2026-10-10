import { registries, type Exporter } from '@huilu/core'
import { textExporters } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { extensionForMime } from '@huilu/recorder'
import { Button, ChevronDown, Download, buttonVariants, cn } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { resultMedia, resultMediaInfo, type ResultDocument } from '@/lib/meeting-library'

for (const exporter of textExporters)
  if (!registries.exporter.has(exporter.id)) registries.exporter.register(exporter)

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function MeetingExports({ doc }: { doc: ResultDocument }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [aac, setAac] = useState(false)
  useEffect(() => {
    let active = true
    void import('@huilu/exporters/media')
      .then((m) => m.supportsM4a())
      .then((ok) => {
        if (active) setAac(ok)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const video = resultMediaInfo(doc, 'video')
  const audio = resultMediaInfo(doc, 'audio')
  const name = doc.meeting.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 160) || 'HuiLu'
  const run = async (exporter: Exporter) => {
    setBusy(true)
    setError(false)
    try {
      downloadBlob(await exporter.export(doc), `${name}.${exporter.fileExtension}`)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const media = async (format: 'mp4' | 'm4a') => {
    const { mediaExporter } = await import('@huilu/exporters/media')
    await run(mediaExporter(format, () => resultMedia(doc, format === 'mp4' ? 'video' : 'audio')))
  }
  const original = async () => {
    setBusy(true)
    setError(false)
    try {
      const kind = video ? 'video' : 'audio'
      const info = resultMediaInfo(doc, kind)
      const blob = await resultMedia(doc, kind)
      if (!blob || !info) throw new Error('missing')
      downloadBlob(blob, `${name}.${extensionForMime(info.mimeType)}`)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="group relative">
      <summary
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
        )}
      >
        <Download aria-hidden="true" />
        {busy ? t('result.exporting') : t('result.export')}
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-4! transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="bg-surface border-border shadow-menu absolute left-0 z-30 mt-2 w-72 max-w-[calc(100vw-6rem)] space-y-1 rounded-2xl border p-2 sm:right-0 sm:left-auto sm:w-80 sm:max-w-none">
        {textExporters.map((e) => (
          <div key={e.id}>
            <Button
              className="w-full justify-start"
              size="sm"
              variant="ghost"
              disabled={busy || (e.id === 'markdown' ? !doc.summary : !doc.transcript)}
              onClick={() => void run(e)}
            >
              {e.id === 'txt'
                ? t('result.exportTxt')
                : e.id === 'srt'
                  ? t('result.exportSrt')
                  : t('result.exportMarkdown')}
            </Button>
            {(e.id === 'markdown' ? !doc.summary : !doc.transcript) && (
              <p className="text-muted-foreground text-caption px-2.5 pb-1">
                {e.id === 'markdown' ? t('result.noSummaryExport') : t('result.noTranscriptExport')}
              </p>
            )}
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            disabled={busy || !video?.mimeType.startsWith('video/mp4')}
            onClick={() => void media('mp4')}
          >
            {t('result.exportMp4')}
          </Button>
          {!video?.mimeType.startsWith('video/mp4') && (
            <p className="text-muted-foreground text-caption px-2.5 pb-1">
              {t('result.mp4Unavailable')}
            </p>
          )}
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            disabled={busy || !audio || !aac}
            onClick={() => void media('m4a')}
          >
            {t('result.exportM4a')}
          </Button>
          {(!audio || !aac) && (
            <p className="text-muted-foreground text-caption px-2.5 pb-1">
              {audio ? t('result.aacUnavailable') : t('history.noTranscriptAudio')}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-1 w-full"
          disabled={busy || (!video && !audio)}
          onClick={() => void original()}
        >
          {t('result.original')}
        </Button>
        {error && (
          <p role="alert" className="text-danger text-caption px-2.5">
            {t('result.exportError')}
          </p>
        )}
      </div>
    </details>
  )
}
