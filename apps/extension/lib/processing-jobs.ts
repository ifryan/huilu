import { IdbJobStore, isActive, type ProcessingJob } from '@huilu/pipeline/jobs'
import { useQuery } from '@tanstack/react-query'

/** 插件页面与离屏文档同源，直接只读 IndexedDB 中的处理任务（写入只在离屏文档） */
const jobs = new IdbJobStore()

export const processingJobsKey = ['processingJobs'] as const

/** 有进行中的任务时每 1.5 秒刷新一次进度，否则只在窗口重新获得焦点 / 手动操作后刷新 */
export function useProcessingJobs() {
  return useQuery({
    queryKey: processingJobsKey,
    queryFn: async () => new Map((await jobs.list()).map((j) => [j.meetingId, j])),
    refetchInterval: (query) =>
      [...(query.state.data?.values() ?? [])].some(isActive) ? 1500 : false,
  })
}

export type { ProcessingJob }
