import type { Meeting } from '../schema/meeting'
import type { TaskContext } from './transcription'

/** 会后处理步骤：转写、纪要、关键帧……步骤之间通过 dependsOn 排序，可断点续跑 */
export interface PipelineStep {
  id: string
  nameKey: string
  dependsOn: string[]
  /** 返回 false 时跳过（例如仅音频模式跳过关键帧） */
  shouldRun(meeting: Meeting): boolean
  run(meeting: Meeting, ctx: TaskContext): Promise<void>
}
