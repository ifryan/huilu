import type { FolderStatus } from '@huilu/storage'
import { hasHostPermission } from '@/platform'
import { connectionUrl, isConfigured, type ProviderKind, type ProviderSettings } from './providers'
import { llmSetting, onboardedSetting, transcriptionSetting } from './settings'

export interface Readiness {
  folder: FolderStatus
  transcription: boolean
  llm: boolean
  onboarded: boolean
}

/** 文件夹状态由调用方提供：插件页面直接查句柄，后台交给离屏文档查（网页面板经由后台） */
export async function checkReadiness(
  folderStatus: () => Promise<FolderStatus>,
): Promise<Readiness> {
  const [folder, transcription, llm, onboarded] = await Promise.all([
    folderStatus(),
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
