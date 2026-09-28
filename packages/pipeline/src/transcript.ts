import type { Speaker, Transcript } from '@huilu/core'

/** 切片转写的结果按切片起点偏移后合并成一份时间轴 */
export function mergeTranscripts(
  pieces: { transcript: Transcript; offsetMs: number }[],
  language: string,
): Transcript {
  const segments = pieces.flatMap(({ transcript, offsetMs }) =>
    transcript.segments.map((s) => ({
      ...s,
      startMs: Math.round(s.startMs + offsetMs),
      endMs: Math.round(Math.max(s.endMs, s.startMs) + offsetMs),
    })),
  )
  segments.sort((a, b) => a.startMs - b.startMs)
  return { language: pieces[0]?.transcript.language ?? language, segments }
}

/** 界面 / 纪要使用的语言：中文会议用简体中文，英文会议用英文；自动识别时按逐字稿里汉字的比例判断 */
export function summaryLocale(meetingLanguage: string, transcript?: Transcript): 'zh-CN' | 'en' {
  if (meetingLanguage.startsWith('zh')) return 'zh-CN'
  if (meetingLanguage === 'en') return 'en'
  const text = transcript?.segments.map((s) => s.text).join('') ?? ''
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0
  const letters = text.match(/[a-z]/gi)?.length ?? 0
  // 一个汉字的信息量约等于英文的 3～4 个字母
  return cjk * 3 >= letters && cjk > 0 ? 'zh-CN' : 'en'
}

/** 按第一次出现的顺序给发言人编号：「发言人 1」「Speaker 1」……用户以后可以在结果页改名 */
export function speakersFromTranscript(transcript: Transcript, locale: string): Speaker[] {
  const ids: string[] = []
  for (const s of transcript.segments) if (!ids.includes(s.speakerId)) ids.push(s.speakerId)
  return ids.map((id, i) => ({
    id,
    name: locale.startsWith('zh') ? `发言人 ${i + 1}` : `Speaker ${i + 1}`,
  }))
}

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
