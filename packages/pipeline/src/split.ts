/**
 * 超过转写服务单文件上限时按静音点切片（ADR 0004 第 4 节）。
 * plan 与 cut 分开：切点写进任务断点，重试 / 重启后沿用同一组切点，已转写的切片不用重做。
 */
export interface AudioSplitter {
  /** 切点（秒），第一个为 0、最后一个为总时长，相邻切点之间的片段不超过 maxBytes */
  plan(blob: Blob, maxBytes: number): Promise<number[]>
  /** 截取 [startS, endS) 为独立的音频文件 */
  cut(blob: Blob, startS: number, endS: number): Promise<{ blob: Blob; mimeType: string }>
}

/**
 * 按平均码率估算每片时长（留 10% 余量）；切点在理想位置前 searchS 秒的窗口里找最安静的一段。
 * findQuietest 只在给定窗口里解码，整段音频不会一次性读进内存
 */
export async function planCuts(
  sizeBytes: number,
  durationS: number,
  maxBytes: number,
  findQuietest: (from: number, to: number) => Promise<number>,
  searchS = 20,
): Promise<number[]> {
  if (sizeBytes <= maxBytes || durationS <= 0) return [0, durationS]
  const pieceS = (durationS * maxBytes * 0.9) / sizeBytes
  const cuts = [0]
  while (durationS - cuts.at(-1)! > pieceS) {
    const last = cuts.at(-1)!
    const ideal = last + pieceS
    const from = Math.max(last + 1, ideal - searchS)
    let cut = await findQuietest(from, ideal)
    // 窗口里没有解码出样本等异常：退回理想位置，保证切点单调递增
    if (!(cut > last && cut <= ideal)) cut = ideal
    cuts.push(cut)
  }
  cuts.push(durationS)
  return cuts
}
