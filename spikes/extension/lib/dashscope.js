// 百炼 Paraformer 录音文件识别：临时文件上传 → 提交异步任务（开启发言人区分）→ 轮询 → 下载结果
// 只用 fetch / FormData / Blob，插件页面、离屏文档和 Node 22 都能直接运行。
// 文档：https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api
//       https://help.aliyun.com/zh/model-studio/get-temporary-file-url

export const DASHSCOPE_ENDPOINTS = {
  cn: 'https://dashscope.aliyuncs.com',
  intl: 'https://dashscope-intl.aliyuncs.com',
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), {
      once: true,
    })
  })

async function json(res, step) {
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  if (!res.ok) {
    const err = new Error(
      `${step} ${res.status}: ${body.code ?? ''} ${body.message ?? body.raw ?? ''}`,
    )
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

/** 第 1 步：申请上传凭证并把文件传到百炼的临时 OSS，返回 48 小时有效的 oss:// 地址 */
export async function uploadTempFile(blob, fileName, { apiKey, model, baseUrl, signal, log }) {
  const policyRes = await fetch(
    `${baseUrl}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal },
  )
  const { data: p } = await json(policyRes, 'getPolicy')
  log?.('policy', { upload_host: p.upload_host, max_file_size_mb: p.max_file_size_mb })
  if (p.max_file_size_mb && blob.size > p.max_file_size_mb * 2 ** 20) {
    throw new Error(
      `文件 ${(blob.size / 2 ** 20).toFixed(1)}MB 超过临时上传上限 ${p.max_file_size_mb}MB`,
    )
  }

  const key = `${p.upload_dir}/${fileName}`
  const form = new FormData()
  form.append('OSSAccessKeyId', p.oss_access_key_id)
  form.append('Signature', p.signature)
  form.append('policy', p.policy)
  form.append('x-oss-object-acl', p.x_oss_object_acl)
  form.append('x-oss-forbid-overwrite', p.x_oss_forbid_overwrite)
  form.append('key', key)
  form.append('success_action_status', '200')
  form.append('file', blob, fileName) // file 必须是最后一个字段
  const t = Date.now()
  const up = await fetch(p.upload_host, { method: 'POST', body: form, signal })
  if (!up.ok) throw new Error(`OSS upload ${up.status}: ${(await up.text()).slice(0, 500)}`)
  log?.('uploaded', { ms: Date.now() - t, MB: +(blob.size / 2 ** 20).toFixed(2) })
  return `oss://${key}`
}

/** 第 2 步：提交录音文件识别任务 */
export async function submitTask(fileUrl, { apiKey, model, baseUrl, signal, parameters }) {
  const res = await fetch(`${baseUrl}/api/v1/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      // 使用 oss:// 临时地址时必须带这个头
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body: JSON.stringify({
      model,
      input: { file_urls: [fileUrl] },
      parameters: { diarization_enabled: true, language_hints: ['zh', 'en'], ...parameters },
    }),
    signal,
  })
  const body = await json(res, 'submit')
  return body.output.task_id
}

/** 第 3 步：轮询任务，成功后下载识别结果 JSON */
export async function waitTask(taskId, { apiKey, baseUrl, signal, log, intervalMs = 3000 }) {
  for (;;) {
    const res = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    const { output, usage } = await json(res, 'poll')
    log?.('poll', { status: output.task_status })
    if (output.task_status === 'SUCCEEDED') {
      const failed = output.results.filter((r) => r.subtask_status !== 'SUCCEEDED')
      if (failed.length) throw new Error(`subtask failed: ${JSON.stringify(failed)}`)
      const result = await json(
        await fetch(output.results[0].transcription_url, { signal }),
        'result',
      )
      return { result, usage }
    }
    if (output.task_status === 'FAILED' || output.task_status === 'UNKNOWN') {
      throw new Error(`task ${output.task_status}: ${output.code ?? ''} ${output.message ?? ''}`)
    }
    await sleep(intervalMs, signal)
  }
}

/** 转成 packages/core 的 Transcript 结构 */
export function toTranscript(result, language = 'zh') {
  const sentences = result.transcripts.flatMap((t) => t.sentences ?? [])
  return {
    language,
    segments: sentences.map((s) => ({
      startMs: s.begin_time,
      endMs: s.end_time,
      speakerId: String(s.speaker_id ?? 0),
      text: s.text,
    })),
  }
}

export async function transcribeWithParaformer(blob, fileName, config) {
  const cfg = { model: 'paraformer-v2', baseUrl: DASHSCOPE_ENDPOINTS.cn, ...config }
  const timings = {}
  let t = Date.now()
  const url = await uploadTempFile(blob, fileName, cfg)
  timings.uploadMs = Date.now() - t
  t = Date.now()
  const taskId = await submitTask(url, cfg)
  cfg.log?.('submitted', { taskId })
  const { result, usage } = await waitTask(taskId, cfg)
  timings.recognizeMs = Date.now() - t
  const transcript = toTranscript(result)
  return {
    transcript,
    usage,
    timings,
    speakers: [...new Set(transcript.segments.map((s) => s.speakerId))],
  }
}
