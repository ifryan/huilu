import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { sendMessage } from '@/lib/messaging'
import { SwitchRow } from '@/components/recording/Switch'

type Permission = PermissionState | 'unknown'

/**
 * 麦克风开关，录制时使用系统默认麦克风。离屏文档不能弹授权框，未授权时引导到插件网页里授权一次
 * （ADR 0004 第 2 节）；弹窗失去焦点就会关闭，也不适合在这里弹授权框。
 */
export function MicrophoneField({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const [permission, setPermission] = useState<Permission>('unknown')

  useEffect(() => {
    let status: PermissionStatus | undefined
    const update = () => setPermission(status?.state ?? 'unknown')
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s
        update()
        s.addEventListener('change', update)
      })
      .catch(() => setPermission('unknown'))
    return () => status?.removeEventListener('change', update)
  }, [])

  return (
    <section className="flex flex-col gap-1.5">
      <SwitchRow label={t('popup.microphone')} checked={enabled} onChange={onChange} />
      {enabled && permission !== 'granted' && (
        <div className="bg-warning-soft text-body2 rounded-control flex items-center justify-between gap-2 px-3 py-2">
          <span>
            {permission === 'denied' ? t('popup.micDenied') : t('popup.micNeedsPermission')}
          </span>
          {permission !== 'denied' && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void sendMessage('openApp', '/permissions/microphone')}
            >
              {t('popup.micGrant')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
