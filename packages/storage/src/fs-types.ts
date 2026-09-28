// File System Access API 中 TypeScript DOM 库尚未收录的部分（Chrome 86+ / 持久化权限 Chrome 122+）

export type FsPermissionState = 'granted' | 'denied' | 'prompt'

export interface FsPermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

export interface PermissionedHandle {
  queryPermission(descriptor?: FsPermissionDescriptor): Promise<FsPermissionState>
  requestPermission(descriptor?: FsPermissionDescriptor): Promise<FsPermissionState>
}

/** 用户选择的文件夹句柄：标准目录句柄 + 权限查询 / 申请 */
export type FolderHandle = FileSystemDirectoryHandle & PermissionedHandle

export interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}

export type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FolderHandle>
