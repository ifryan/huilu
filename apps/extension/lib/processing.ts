// 处理管线在插件中的装配：服务配置解析、OPFS 录制读取。纯逻辑部分不依赖 WXT，便于单元测试
import { registries, type LlmProvider, type TranscriptionProvider } from '@huilu/core'
import type { MeetingSource, ResolvedService, ResolvedServices } from '@huilu/pipeline'
import { extensionForMime, type RecordingStore } from '@huilu/recorder'
import { connectionUrl, type ProviderKind } from './providers'
import type { ProcessingSettings } from './processing-settings'
import type { ProviderSettings } from './provider-settings'

export type { ProcessingSettings }

/**
 * 当前选择的服务商 + 已保存的配置。与设置页的 getProvider 不同：未知服务商不回退到默认
 * （否则会把 A 家的配置 / Key 发给 B 家）；域名权限缺失时明确报出，而不是让请求在离屏文档里失败
 */
export async function resolveService<P extends TranscriptionProvider | LlmProvider>(
  kind: ProviderKind,
  settings: ProviderSettings,
  hasHostPermission: (url: string) => Promise<boolean>,
): Promise<ResolvedService<P>> {
  const registry = kind === 'transcription' ? registries.transcription : registries.llm
  if (!registry.has(settings.providerId)) return { ok: false, issue: 'unknownProvider' }
  const provider = registry.get(settings.providerId) as P
  const saved = settings.configs[settings.providerId]
  const parsed = saved === undefined ? undefined : provider.configSchema.safeParse(saved)
  if (!parsed?.success) return { ok: false, issue: 'notConfigured' }
  const url = connectionUrl(provider.id, parsed.data as Record<string, unknown>)
  if (url && !(await hasHostPermission(url).catch(() => false))) {
    return { ok: false, issue: 'hostPermission' }
  }
  return { ok: true, provider, config: parsed.data }
}

export async function resolveServices(
  settings: ProcessingSettings,
  hasHostPermission: (url: string) => Promise<boolean>,
): Promise<ResolvedServices> {
  const [transcription, llm] = await Promise.all([
    resolveService<TranscriptionProvider>(
      'transcription',
      settings.transcription,
      hasHostPermission,
    ),
    resolveService<LlmProvider>('llm', settings.llm, hasHostPermission),
  ])
  return { transcription, llm }
}

/** 处理管线读取 OPFS 中的录制：recordings/<id>/{manifest.json, meeting.json, audio/, video/} */
export function recordingSource(store: RecordingStore): MeetingSource {
  const open = async (id: string) => {
    const dir = await store.open(id)
    const manifest = await dir?.readManifest()
    return dir && manifest ? { dir, manifest } : undefined
  }
  return {
    async readMeeting(id) {
      return (await store.open(id))?.readMeeting()
    },
    async writeMeeting(id, meeting) {
      const dir = await store.open(id)
      if (!dir) throw new Error(`Recording ${id} not found`)
      await dir.writeMeeting(meeting)
    },
    async readAudio(id) {
      const found = await open(id)
      const audio = found?.manifest.tracks.audio
      if (!found || !audio?.chunks) return undefined
      return {
        blob: await found.dir.readTrack('audio', audio.chunks, audio.mimeType.split(';')[0]!),
        mimeType: audio.mimeType,
      }
    },
    async readMedia(id) {
      const found = await open(id)
      if (!found) return []
      const out: { name: string; blob: Blob }[] = []
      for (const name of ['video', 'audio'] as const) {
        const track = found.manifest.tracks[name]
        if (!track?.chunks) continue
        // 分片按顺序拼接即完整文件（视频为分片 MP4，Chrome / VLC / ffmpeg 可直接播放）
        const blob = await found.dir.readTrack(name, track.chunks, track.mimeType.split(';')[0]!)
        out.push({ name: `${name}.${extensionForMime(track.mimeType)}`, blob })
      }
      return out
    },
  }
}
