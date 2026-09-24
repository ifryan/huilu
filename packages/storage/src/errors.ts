/** 数据文件夹未选择或授权失效：调用方应把任务标为「待写入」，并在可见页面提示重新授权 */
export class FolderNotReadyError extends Error {
  override name = 'FolderNotReadyError'
  constructor(readonly permission: 'unset' | 'prompt' | 'denied') {
    super(`数据文件夹不可用（${permission}）`)
  }
}

/**
 * 写后回读的文件大小与预期不一致。
 * OPFS 在异常情况下可能「写入不抛错但文件为 0 字节」（ADR 0004 第 2 节），录制端收到后必须立即停止。
 */
export class WriteVerificationError extends Error {
  override name = 'WriteVerificationError'
  constructor(
    readonly path: string,
    readonly expectedBytes: number,
    readonly actualBytes: number,
  ) {
    super(`写入校验失败：${path} 预期 ${expectedBytes} 字节，实际 ${actualBytes} 字节`)
  }
}

export class InvalidPathError extends Error {
  override name = 'InvalidPathError'
  constructor(readonly path: string) {
    super(`非法路径：${JSON.stringify(path)}`)
  }
}
