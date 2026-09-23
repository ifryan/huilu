import type { Meeting } from '../schema/meeting'
import type { Summary } from '../schema/summary'
import type { Transcript } from '../schema/transcript'

export interface ExportInput {
  meeting: Meeting
  transcript?: Transcript
  summary?: Summary
}

export interface Exporter {
  id: string
  nameKey: string
  fileExtension: string
  mimeType: string
  export(input: ExportInput): Promise<Blob>
}
