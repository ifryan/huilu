import { registries } from '@huilu/core'
import { RECORDINGS_DIR } from '@huilu/recorder'
import { IdbHandleStore, LocalFolderStorageAdapter, OpfsStorageAdapter } from '@huilu/storage'
import { localResults } from './capabilities'
export { localResults }
export const dataFolder = new LocalFolderStorageAdapter(new IdbHandleStore())
export const opfs = new OpfsStorageAdapter({ base: RECORDINGS_DIR })
for (const adapter of [dataFolder, opfs])
  if (!registries.storage.has(adapter.id)) registries.storage.register(adapter)
