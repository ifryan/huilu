/** 存储后端：本地文件夹（File System Access）、OPFS；将来可加服务端、WebDAV */
export interface StorageAdapter {
  id: string
  /** 是否可用（例如文件夹授权是否仍有效） */
  isReady(): Promise<boolean>
  /** 目录不存在或确实没有任何文件 / 子目录时为 true；权限错误不视为空。 */
  isDirectoryEmpty(path: string): Promise<boolean>
  listMeetingDirs(): Promise<string[]>
  readFile(path: string): Promise<Blob | undefined>
  writeFile(path: string, data: Blob | string): Promise<void>
  /** 追加写入，用于录制分片落盘 */
  appendFile(path: string, data: Blob): Promise<void>
  remove(path: string): Promise<void>
}
