import { useTranslation } from '@huilu/i18n'
import { useRecorderStatus } from '@/lib/recording'

/**
 * 录制窗口只承载窗口 / 屏幕采集，不重复显示进度：开始后由后台最小化，
 * 计时与暂停 / 继续 / 结束都在侧边栏，结束后自动关闭。
 */
export function RecorderWindow() {
  const { t } = useTranslation()
  const { data: status } = useRecorderStatus()
  const active = status && status.state !== 'idle'

  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">{t('app.name')}</h1>
      <p className="text-sm">
        {active ? t('recorderWindow.recording') : t('recorderWindow.choosing')}
      </p>
      <p className="text-muted-foreground text-xs">{t('recorderWindow.keepOpen')}</p>
    </main>
  )
}
