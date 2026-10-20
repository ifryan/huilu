import { useTranslation } from '@huilu/i18n'
import { Button, fieldClass } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { libraryKey } from '@/lib/library'
import { meetingLibraryKey, saveLibraryEdit, type LibraryItem } from '@/lib/meeting-library'
import type { ProcessingJob } from '@/lib/processing-jobs'

export type HistoryNotice = 'library.titleSaved' | 'library.archived' | 'library.restored'

export function HistoryActions({
  item,
  job,
  jobsLoaded,
  onSaved,
}: {
  item: LibraryItem
  job?: ProcessingJob
  jobsLoaded: boolean
  onSaved: (message: HistoryNotice) => void
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState<'title' | 'archive'>()
  const busy =
    !jobsLoaded ||
    item.meeting?.status === 'recording' ||
    item.local?.state === 'unfinished' ||
    (job && ['queued', 'running', 'waitingFolder'].includes(job.state))
  const disabled =
    !item.id || !item.available || !!item.folder?.issue || item.local?.state === 'damaged' || !!busy
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        title={busy ? t('library.busy') : undefined}
        onClick={() => setAction('title')}
      >
        {t('library.editTitle')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        title={busy ? t('library.busy') : undefined}
        onClick={() => setAction('archive')}
      >
        {item.archived ? t('library.restore') : t('library.archive')}
      </Button>
      {busy && (
        <span className="text-muted-foreground text-caption w-full sm:max-w-44">
          {t('library.busy')}
        </span>
      )}
      {action && (
        <HistoryDialog
          item={item}
          action={action}
          onClose={() => setAction(undefined)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

function HistoryDialog({
  item,
  action,
  onClose,
  onSaved,
}: {
  item: LibraryItem
  action: 'title' | 'archive'
  onClose: () => void
  onSaved: (message: HistoryNotice) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [title, setTitle] = useState(item.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const label =
    action === 'title'
      ? t('library.editTitle')
      : item.archived
        ? t('library.restore')
        : t('library.archive')
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  function close() {
    dialog.current?.close()
    onClose()
  }
  async function save() {
    if (inFlight.current) return
    if (action === 'title' && !title.trim()) {
      setError(t('library.emptyTitle'))
      return
    }
    inFlight.current = true
    setSaving(true)
    setError(undefined)
    try {
      await saveLibraryEdit(
        item,
        action === 'title'
          ? { type: 'title', previous: item.title, value: title }
          : { type: 'archive', previous: item.archived, value: !item.archived },
      )
      await Promise.all([
        client.invalidateQueries({ queryKey: meetingLibraryKey }),
        client.invalidateQueries({ queryKey: libraryKey }),
        client.invalidateQueries({ queryKey: ['meeting', item.id] }),
      ])
      onSaved(
        action === 'title'
          ? 'library.titleSaved'
          : item.archived
            ? 'library.restored'
            : 'library.archived',
      )
      close()
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message === 'meetingBusy'
          ? t('library.busy')
          : message === 'editConflict' || message === 'folderChanged'
            ? t('library.editConflict')
            : t('library.editFailed'),
      )
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="history-action-title"
      aria-describedby={action === 'archive' ? 'history-action-hint' : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (!inFlight.current) close()
      }}
      className="border-border bg-surface text-foreground shadow-card m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border p-5 backdrop:bg-black/30"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        aria-busy={saving}
      >
        <h2 id="history-action-title" className="text-title3 font-semibold">
          {label}
        </h2>
        {action === 'title' ? (
          <label className="text-body flex flex-col gap-2">
            {t('result.title')}
            <input
              autoFocus
              value={title}
              maxLength={200}
              className={fieldClass}
              disabled={saving}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        ) : (
          <>
            <p className="text-body font-medium break-words">{item.title}</p>
            <p id="history-action-hint" className="text-muted-foreground text-body">
              {item.archived ? t('library.restoreHint') : t('library.archiveHint')}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-danger text-body">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={close}>
            {t('library.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('library.saving') : action === 'title' ? t('library.save') : label}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
