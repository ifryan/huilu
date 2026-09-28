import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  Mp4OutputFormat,
  canEncodeAudio,
  Mp4InputFormat,
} from 'mediabunny'
import type { Exporter } from '@huilu/core'

export async function supportsM4a(): Promise<boolean> {
  return canEncodeAudio('aac')
}

/** Source is injected; no URL fetching or filename-based format guesses. */
export function mediaExporter(
  format: 'mp4' | 'm4a',
  source: () => Promise<Blob | undefined>,
): Exporter {
  return {
    id: format,
    nameKey: `result.export${format === 'mp4' ? 'Mp4' : 'M4a'}`,
    fileExtension: format,
    mimeType: format === 'mp4' ? 'video/mp4' : 'audio/mp4',
    async export() {
      const blob = await source()
      if (!blob) throw new Error('noMedia')
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
      try {
        if (format === 'mp4') {
          if (!(await input.getPrimaryVideoTrack())) throw new Error('noVideo')
          // Existing MP4 can be downloaded without buffering or re-encoding it.
          if ((await input.getFormat()) instanceof Mp4InputFormat)
            return blob.slice(0, blob.size, 'video/mp4')
          throw new Error('mp4Unavailable')
        }
        const audio = await input.getPrimaryAudioTrack()
        if (!audio || !(await audio.canDecode()) || !(await supportsM4a()))
          throw new Error('aacUnavailable')
        const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
        const conversion = await Conversion.init({
          input,
          output,
          video: { discard: true },
          audio: { codec: 'aac', bitrate: 128000 },
        })
        if (!conversion.isValid) throw new Error('aacUnavailable')
        await conversion.execute()
        const buffer = output.target.buffer
        if (!buffer) throw new Error('emptyMedia')
        return new Blob([buffer], { type: 'audio/mp4' })
      } finally {
        input.dispose()
      }
    },
  }
}
