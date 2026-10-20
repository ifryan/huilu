import type { FolderStatus } from '@huilu/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { dataFolder } from '@/platform/storage'
import { inExtensionPage } from './extension-context'
import { sendMessage } from './messaging'
import { checkReadiness } from './readiness-check'
import {
  dataFolderAuthorizedSetting,
  llmSetting,
  onboardedSetting,
  transcriptionSetting,
} from './settings'

export { isReady, type Readiness } from './readiness-check'

export const readinessKey = ['readiness'] as const

/** 网页面板（内容脚本）读不到插件的文件夹句柄和域名权限，交给后台查 */
function loadReadiness() {
  return inExtensionPage() ? checkReadiness(() => dataFolder.status()) : sendMessage('getReadiness')
}

/**
 * 就绪状态：文件夹是否授权、API 是否配置。
 * 授权状态没有变化事件，靠窗口重新获得焦点时刷新；设置变化通过 storage.watch 实时刷新。
 */
export function useReadiness() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: readinessKey, queryFn: loadReadiness })

  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: readinessKey })
    const unwatch = [
      transcriptionSetting,
      llmSetting,
      onboardedSetting,
      dataFolderAuthorizedSetting,
    ].map((item) => item.watch(refresh))
    return () => unwatch.forEach((fn) => fn())
  }, [queryClient])

  return query
}

/** 选择 / 重新授权数据文件夹；必须在点击事件中调用 */
export function useFolderActions() {
  const queryClient = useQueryClient()

  const after = useCallback(
    async (status: FolderStatus | undefined) => {
      if (status?.permission === 'granted' && status.name) {
        await dataFolderAuthorizedSetting.setValue({ name: status.name, at: Date.now() })
      }
      await queryClient.invalidateQueries({ queryKey: readinessKey })
      return status
    },
    [queryClient],
  )

  return {
    pick: useCallback(() => dataFolder.pick().then(after), [after]),
    reauthorize: useCallback(() => dataFolder.requestPermission().then(after), [after]),
  }
}
