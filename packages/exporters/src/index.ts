import { mappedSummary, mappedTranscript, type ExportInput, type Exporter } from '@huilu/core'

export function timestamp(ms: number, srt = false): string {
  const value = Math.max(0, Math.round(ms))
  const hours = Math.floor(value / 3600000)
  const minutes = Math.floor(value / 60000) % 60
  const seconds = Math.floor(value / 1000) % 60
  const pad = (n: number, count = 2) => String(n).padStart(count, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${srt ? ',' + pad(value % 1000, 3) : ''}`
}
const nameOf = (input: ExportInput, id: string) =>
  input.meeting.speakers.find((s) => s.id === id)?.name ?? id
const requireTranscript = (input: ExportInput) => {
  if (!input.transcript) throw new Error('noTranscript')
  return mappedTranscript(input.meeting, input.transcript)
}
export const txtExporter: Exporter = {
  id: 'txt',
  nameKey: 'result.exportTxt',
  fileExtension: 'txt',
  mimeType: 'text/plain',
  async export(input) {
    const lines = requireTranscript(input).segments.map(
      (s) => `[${timestamp(s.startMs)}] ${nameOf(input, s.speakerId)}: ${s.text}`,
    )
    return new Blob([`${input.meeting.title}\n\n${lines.join('\n\n')}\n`], {
      type: 'text/plain;charset=utf-8',
    })
  },
}
export const srtExporter: Exporter = {
  id: 'srt',
  nameKey: 'result.exportSrt',
  fileExtension: 'srt',
  mimeType: 'application/x-subrip',
  async export(input) {
    const lines = requireTranscript(input)
      .segments.filter((s) => s.endMs > s.startMs)
      .map(
        (s, i) =>
          `${i + 1}\r\n${timestamp(s.startMs, true)} --> ${timestamp(s.endMs, true)}\r\n${nameOf(input, s.speakerId)}: ${s.text.replace(/\r?\n\s*\r?\n/g, '\n')}`,
      )
    return new Blob([lines.join('\r\n\r\n') + '\r\n'], {
      type: 'application/x-subrip;charset=utf-8',
    })
  },
}
export const markdownExporter: Exporter = {
  id: 'markdown',
  nameKey: 'result.exportMarkdown',
  fileExtension: 'md',
  mimeType: 'text/markdown',
  async export(input) {
    if (!input.summary) throw new Error('noSummary')
    const summary = mappedSummary(input.meeting, input.summary)
    const zh = input.meeting.language.startsWith('zh')
    const labels = zh
      ? ['关键词', '全文概要', '章节速览', '发言总结', '要点回顾', '待办事项']
      : ['Keywords', 'Overview', 'Chapters', 'Speaker summaries', 'Key points', 'Action items']
    const escape = (s: string) => s.replace(/[\\`*_{}[\]<>#]/g, '\\$&')
    const section = (i: number, lines: string[]) => `## ${labels[i]}\n\n${lines.join('\n\n')}\n`
    const text = [
      `# ${escape(input.meeting.title)}\n`,
      section(0, [summary.keywords.map(escape).join(', ')]),
      section(1, [escape(summary.overview)]),
      section(
        2,
        summary.chapters.map(
          (c) => `- ${timestamp(c.startMs)} **${escape(c.title)}** — ${escape(c.summary)}`,
        ),
      ),
      section(
        3,
        summary.speakerSummaries.map(
          (s) => `- **${escape(nameOf(input, s.speakerId))}**: ${escape(s.summary)}`,
        ),
      ),
      section(
        4,
        summary.keyPoints.map((s) => `- ${escape(s)}`),
      ),
      section(
        5,
        summary.actionItems.map(
          (a) =>
            `- [ ] ${escape(a.text)}${a.owner ? ` · ${escape(a.owner)}` : ''}${a.due ? ` · ${escape(a.due)}` : ''}`,
        ),
      ),
    ].join('\n')
    return new Blob([text], { type: 'text/markdown;charset=utf-8' })
  },
}
export const textExporters = [txtExporter, srtExporter, markdownExporter]
