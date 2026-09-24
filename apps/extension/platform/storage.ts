import { registries } from '@huilu/core'
import { RECORDINGS_DIR } from '@huilu/recorder'
import { IdbHandleStore, LocalFolderStorageAdapter, OpfsStorageAdapter } from '@huilu/storage'

/**
 * 存储适配器单例。插件的所有页面与离屏文档同源，共享同一个 IndexedDB 句柄与 OPFS。
 * - dataFolder：用户选择的数据文件夹（最终文件）；授权可能失效，写入前需 isReady()
 * - opfs：录制分片等临时数据，不需要授权。根目录与 @huilu/recorder 一致（recordings/<id>/），
 *   listMeetingDirs() 即已结束、待处理的录制
 */
export const dataFolder = new LocalFolderStorageAdapter(new IdbHandleStore())
export const opfs = new OpfsStorageAdapter({ base: RECORDINGS_DIR })

for (const adapter of [dataFolder, opfs]) {
  if (!registries.storage.has(adapter.id)) registries.storage.register(adapter)
}
