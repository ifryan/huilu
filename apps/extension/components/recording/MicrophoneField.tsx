import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useEffect, useState } from 'react'
import { sendMessage } from '@/lib/messaging'

type Permission = PermissionState | 'unknown'

/**
 * 麦克风开关与设备选择。离屏文档不能弹授权框，未授权时引导到插件网页里授权一次（ADR 0004 第 2 节）；
 * 弹窗失去焦点就会关闭，也不适合在这里弹授权框。
 */
export function MicrophoneField({
  enabled,
  deviceId,
  onChange,
}: {
  enabled: boolean
  deviceId: string | undefined
  onChange: (next: { enabled: boolean; deviceId: string | undefined }) => void
}) {
  const { t } = useTranslation()
  const [permission, setPermission] = useState<Permission>('unknown')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

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

  useEffect(() => {
    if (permission !== 'granted') return
    // 设备名称只有授权后才能拿到；default / communications 是系统默认设备的别名
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) =>
        setDevices(
          all.filter(
            (d) =>
              d.kind === 'audioinput' &&
              d.deviceId !== 'default' &&
              d.deviceId !== 'communications',
          ),
        ),
      )
  }, [permission])

  return (
    <section className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>{t('popup.microphone')}</span>
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={enabled}
          onChange={(e) => onChange({ enabled: e.target.checked, deviceId })}
        />
      </label>
      {enabled && permission === 'granted' && (
        <select
          className="border-border bg-background rounded-lg border px-2 py-1.5 text-sm"
          value={deviceId ?? ''}
          onChange={(e) => onChange({ enabled, deviceId: e.target.value || undefined })}
        >
          <option value="">{t('popup.micDefault')}</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId.slice(0, 8)}
            </option>
          ))}
        </select>
      )}
      {enabled && permission !== 'granted' && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs">
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
