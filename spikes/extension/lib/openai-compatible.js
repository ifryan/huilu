// OpenAI 兼容转写接口（Groq / OpenAI 预设）。超过单文件上限时，由 split.js 先按静音点切片，这里按偏移合并。
// 只用 fetch / FormData / Blob，插件页面、离屏文档和 Node 22 都能直接运行。

export const OPENAI_COMPATIBLE_PRESETS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    maxFileBytes: 25 * 2 ** 20,
  },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', maxFileBytes: 25 * 2 ** 20 },
}

export async function transcribeOne(blob, fileName, { baseUrl, apiKey, model, language, signal }) {
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  if (language) form.append('language', language)
  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`transcriptions ${res.status}: ${text.slice(0, 500)}`)
    err.status = res.status
    err.retryAfter = res.headers.get('retry-after')
    throw err
  }
  return JSON.parse(text)
}

/**
 * pieces: [{ blob, offsetS }]，offsetS 是切片在原音频中的起点。
 * Whisper 不区分发言人，speakerId 统一为 '0'。
 */
export async function transcribePieces(pieces, config) {
  const segments = []
  let language
  const timings = []
  for (const [i, piece] of pieces.entries()) {
    const t = Date.now()
    const r = await transcribeOne(piece.blob, `part-${i}.${piece.ext ?? 'webm'}`, config)
    timings.push({ piece: i, MB: +(piece.blob.size / 2 ** 20).toFixed(2), ms: Date.now() - t })
    config.log?.('piece', timings.at(-1))
    language ??= r.language
    for (const s of r.segments ?? []) {
      segments.push({
        startMs: Math.round((s.start + piece.offsetS) * 1000),
        endMs: Math.round((s.end + piece.offsetS) * 1000),
        speakerId: '0',
        text: s.text.trim(),
      })
    }
  }
  return { transcript: { language: language ?? config.language ?? 'zh', segments }, timings }
}
