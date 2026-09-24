import type { FolderStatus } from '@huilu/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { hasHostPermission } from '@/platform'
import { dataFolder } from '@/platform/storage'
import { connectionUrl, isConfigured, type ProviderKind, type ProviderSettings } from './providers'
import {
  dataFolderAuthorizedSetting,
  llmSetting,
  onboardedSetting,
  transcriptionSetting,
} from './settings'

export interface Readiness {
  folder: FolderStatus
  transcription: boolean
  llm: boolean
  onboarded: boolean
}

export const readinessKey = ['readiness'] as const

async function loadReadiness(): Promise<Readiness> {
  const [folder, transcription, llm, onboarded] = await Promise.all([
    dataFolder.status(),
    transcriptionSetting.getValue(),
    llmSetting.getValue(),
    onboardedSetting.getValue(),
  ])
  return {
    folder,
    transcription: await isReady('transcription', transcription),
    llm: await isReady('llm', llm),
    onboarded,
  }
}

/**
 * 配置齐全，并且插件能访问该服务地址。自定义 Base URL 的权限可能从未授予或已被撤销：
 * 离屏文档无法弹窗申请，此时请求必然失败，不能显示为就绪。
 */
export async function isReady(kind: ProviderKind, settings: ProviderSettings): Promise<boolean> {
  if (!isConfigured(kind, settings)) return false
  const url = connectionUrl(settings.providerId, settings.configs[settings.providerId] ?? {})
  return url ? hasHostPermission(url).catch(() => false) : true
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
