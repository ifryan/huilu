import { IdbJobStore, type ProcessingJob } from '@huilu/pipeline/jobs'
import { useQuery } from '@tanstack/react-query'

/** 插件页面与离屏文档同源，直接只读 IndexedDB 中的处理任务（写入只在离屏文档） */
const jobs = new IdbJobStore()

export const processingJobsKey = ['processingJobs'] as const

/** 页面可见时每 1.5 秒刷新，包括空列表 / 等待授权：其他上下文可随时新增或激活任务 */
export function useProcessingJobs() {
  return useQuery({
    queryKey: processingJobsKey,
    queryFn: async () => new Map((await jobs.list()).map((j) => [j.meetingId, j])),
    refetchInterval: 1500,
  })
}

export type { ProcessingJob }
