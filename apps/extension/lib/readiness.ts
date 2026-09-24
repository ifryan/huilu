import type { FolderStatus } from '@huilu/storage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { dataFolder } from '@/platform/storage'
import { isConfigured } from './providers'
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
    transcription: isConfigured('transcription', transcription),
    llm: isConfigured('llm', llm),
    onboarded,
  }
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
