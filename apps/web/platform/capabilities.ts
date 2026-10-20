export function storageMode(scope: {
  isSecureContext?: boolean
  showDirectoryPicker?: unknown
}): 'folder' | 'browser' {
  return scope.isSecureContext && typeof scope.showDirectoryPicker === 'function'
    ? 'folder'
    : 'browser'
}
export const localResults = storageMode(globalThis) === 'browser'
export async function requestPersistence() {
  return navigator.storage?.persist?.().catch(() => false) ?? false
}
