import type { RecordingMode } from '@huilu/core'
import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { recordingModeSetting } from '@/lib/settings'

const MODES: RecordingMode[] = ['audio', 'video']

export function Popup() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<RecordingMode>('audio')

  useEffect(() => {
    void recordingModeSetting.getValue().then(setMode)
  }, [])

  const selectMode = (next: RecordingMode) => {
    setMode(next)
    void recordingModeSetting.setValue(next)
  }

  return (
    <main className="flex w-80 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('app.name')}</h1>
        <Button variant="outline" size="sm" onClick={() => void sendMessage('openApp', '/')}>
          {t('popup.openApp')}
        </Button>
      </header>

      <section className="flex flex-col gap-2">
        <span className="text-muted-foreground text-sm">{t('popup.mode')}</span>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm',
                mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border',
              )}
            >
              {t(m === 'audio' ? 'popup.modeAudio' : 'popup.modeVideo')}
            </button>
          ))}
        </div>
      </section>

      {/* 录制功能在「录制」子任务中实现 */}
      <Button size="lg" disabled title={t('common.comingSoon')}>
        {t('popup.start')}
      </Button>
    </main>
  )
}
