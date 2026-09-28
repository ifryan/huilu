import type { Meeting } from '@huilu/core'

/**
 * 数据文件夹中每场会议的子文件夹名：「2026-09-24_1430_需求评审」（PRD 第 4 节），按字典序即时间顺序。
 * 去掉各系统文件名不允许的字符；标题为空时用会议 id
 */
export function meetingFolderName(meeting: Pick<Meeting, 'id' | 'title' | 'createdAt'>): string {
  const d = new Date(meeting.createdAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
  const title = meeting.title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60)
    .trim()
  return `${stamp}_${title || meeting.id}`
}
