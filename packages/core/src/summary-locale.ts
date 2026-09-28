import type { Transcript } from './schema/transcript'

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
