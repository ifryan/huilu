import { defineSummaryTemplate } from '../extension-points/llm'
import { Summary } from '../schema/summary'

/** 内置「通用」纪要模板：输出标准 Summary 结构 */
export const generalSummaryTemplate = defineSummaryTemplate({
  id: 'general',
  nameKey: 'summaryTemplate.general',
  outputSchema: Summary,
  systemPrompt: (locale) =>
    locale.startsWith('zh')
      ? [
          '你是专业的会议记录助手。根据会议逐字稿生成结构化纪要：',
          '关键词、会议概要、按时间顺序的章节（startMs 为章节开始的毫秒数）、每位发言人的发言总结、要点、待办事项（尽量标注负责人与截止时间）。',
          '只依据逐字稿内容，不要编造；使用简体中文输出。',
        ].join('\n')
      : [
          'You are a professional meeting assistant. Produce structured minutes from the transcript:',
          'keywords, an overview, chronological chapters (startMs = chapter start in milliseconds), a summary per speaker, key points, and action items (with owner and due date when known).',
          'Only use information from the transcript; do not make things up. Write in English.',
        ].join('\n'),
})
