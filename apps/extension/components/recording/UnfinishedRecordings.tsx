import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { sendMessage, type UnfinishedRecording } from '@/lib/messaging'
import { formatBytes, formatDuration } from '@/lib/recording'

/** 浏览器崩溃 / 录制被中断后留在 OPFS 中的录制：提示「恢复未完成的录制」 */
export function UnfinishedRecordings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string>()
  const { data } = useQuery({
    queryKey: ['unfinishedRecordings'],
    queryFn: () => sendMessage('listUnfinishedRecordings'),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['unfinishedRecordings'] })

  const recover = useMutation({
    mutationFn: async (item: UnfinishedRecording) => {
      const { saved } = await sendMessage('recoverRecording', item.id)
      return { item, saved }
    },
    onSuccess: ({ item, saved }) => {
      setNotice(
        saved
          ? t('unfinished.recovered', { title: item.title })
          : t('unfinished.nothingToRecover', { title: item.title }),
      )
      void refresh()
    },
  })
  const discard = useMutation({
    mutationFn: (id: string) => sendMessage('discardRecording', id),
    onSuccess: () => void refresh(),
  })

  if (!data?.length && !notice) return null
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      {notice && <p className="text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {data && data.length > 0 && (
        <>
          <div>
            <div className="font-medium">{t('unfinished.title')}</div>
            <div className="text-muted-foreground">{t('unfinished.body')}</div>
          </div>
          <ul className="flex flex-col gap-2">
            {data.map((item) => (
              <UnfinishedItem
                key={item.id}
                item={item}
                busy={recover.isPending || discard.isPending}
                onRecover={() => recover.mutate(item)}
                onDiscard={() => discard.mutate(item.id)}
              />
            ))}
          </ul>
          {(recover.error ?? discard.error) && (
            <p className="text-danger">{String(recover.error ?? discard.error)}</p>
          )}
        </>
      )}
    </section>
  )
}

function UnfinishedItem({
  item,
  busy,
  onRecover,
  onDiscard,
}: {
  item: UnfinishedRecording
  busy: boolean
  onRecover: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="bg-background flex flex-col gap-2 rounded-md p-2">
      <div className="flex justify-between gap-2">
        <span className="truncate font-medium">{item.title}</span>
        <span className="text-muted-foreground shrink-0">
          {formatDuration(item.activeMs)} · {formatBytes(item.bytes)}
        </span>
      </div>
      <div className="text-muted-foreground">{new Date(item.startedAt).toLocaleString()}</div>
      {confirming ? (
        <div className="flex items-center justify-between gap-2">
          <span>{t('unfinished.confirmDiscard')}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              {t('sidepanel.cancel')}
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={onDiscard}>
              {t('unfinished.discard')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
            {t('unfinished.discard')}
          </Button>
          <Button size="sm" disabled={busy} onClick={onRecover}>
            {t('unfinished.recover')}
          </Button>
        </div>
      )}
    </li>
  )
}
