import { registries, type Exporter } from '@huilu/core'
import { textExporters } from '@huilu/exporters'
import { useTranslation } from '@huilu/i18n'
import { extensionForMime } from '@huilu/recorder'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { resultMedia, type ResultDocument } from '@/lib/meeting-library'

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
  const video = doc.meeting.media?.video
  const audio = doc.meeting.media?.audio
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
      const info = doc.meeting.media?.[kind]
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
    <details className="relative">
      <summary className="border-border cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium">
        {busy ? t('result.exporting') : t('result.export')}
      </summary>
      <div className="bg-background border-border absolute left-0 z-30 mt-2 w-72 max-w-[calc(100vw-6rem)] space-y-3 rounded-xl border p-4 shadow-lg sm:right-0 sm:left-auto sm:w-80 sm:max-w-none">
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
              <p className="text-muted-foreground px-3 text-xs">
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
            <p className="text-muted-foreground px-3 text-xs">{t('result.mp4Unavailable')}</p>
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
            <p className="text-muted-foreground px-3 text-xs">
              {audio ? t('result.aacUnavailable') : t('history.noTranscriptAudio')}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy || (!video && !audio)}
          onClick={() => void original()}
        >
          {t('result.original')}
        </Button>
        {error && (
          <p role="alert" className="text-danger text-xs">
            {t('result.exportError')}
          </p>
        )}
      </div>
    </details>
  )
}
