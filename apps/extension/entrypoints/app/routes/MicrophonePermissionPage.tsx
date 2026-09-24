import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useState } from 'react'

/**
 * 麦克风授权页：离屏文档不能弹授权框，弹窗失去焦点会关闭，所以在插件网页里授权一次；
 * 同源（chrome-extension://<id>）的离屏文档之后可以直接使用麦克风。
 */
export function MicrophonePermissionPage() {
  const { t } = useTranslation()
  const [result, setResult] = useState<{ ok: boolean; error?: string }>()

  const request = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setResult({ ok: true })
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
    }
  }

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('permissions.micTitle')}</h1>
      <p className="text-muted-foreground">{t('permissions.micBody')}</p>
      <Button className="self-start" onClick={() => void request()}>
        {t('permissions.micButton')}
      </Button>
      {result?.ok && (
        <p className="text-emerald-700 dark:text-emerald-400">{t('permissions.micGranted')}</p>
      )}
      {result && !result.ok && (
        <p className="text-danger">{t('permissions.micFailed', { error: result.error })}</p>
      )}
    </section>
  )
}
