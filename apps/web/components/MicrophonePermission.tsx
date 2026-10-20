import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useState } from 'react'
export function MicrophonePermission() {
  const { t } = useTranslation()
  const [result, setResult] = useState<string>()
  const request = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setResult(t('web.micGranted'))
    } catch (error) {
      setResult(String(error))
    }
  }
  return (
    <section className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-headline font-semibold">{t('web.micOnboarding')}</h2>
      <Button variant="outline" className="self-start" onClick={() => void request()}>
        {t('permissions.micButton')}
      </Button>
      {result && <p role="status">{result}</p>}
    </section>
  )
}
