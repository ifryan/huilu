// 录制结果的检查与整理：浏览器内播放 / 拖动测试、用 mediabunny 解析时长、把 fMP4 转封装为普通 MP4

import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from '../vendor/mediabunny.min.mjs'

/** 用 <video> 加载并拖动到若干位置，记录 duration 与每次 seek 的耗时和落点 */
export async function playbackCheck(blob, positions = [0.1, 0.5, 0.9]) {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'metadata'
  const once = (ev) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), 30_000)
      video.addEventListener(ev, () => (clearTimeout(timer), resolve()), { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })
  try {
    video.src = url
    await once('loadedmetadata')
    const result = { reportedDuration: video.duration, seeks: [] }
    let duration = video.duration
    if (!Number.isFinite(duration)) {
      // WebM / 部分 fMP4 没有写时长：跳到极大位置迫使浏览器扫描出真实时长
      video.currentTime = 1e9
      await once('seeked')
      duration = video.duration
      video.currentTime = 0
      await once('seeked')
    }
    result.resolvedDuration = duration
    for (const p of positions) {
      const target = duration * p
      const t = performance.now()
      video.currentTime = target
      await once('seeked')
      result.seeks.push({
        target: +target.toFixed(2),
        landed: +video.currentTime.toFixed(2),
        ms: Math.round(performance.now() - t),
      })
    }
    return result
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function probe(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const format = await input.getFormat()
  const tracks = await input.getTracks()
  return {
    format: format.name,
    duration: await input.computeDuration(),
    tracks: await Promise.all(
      tracks.map(async (t) => ({
        type: t.type,
        codec: t.codec,
        firstTimestamp: await t.getFirstTimestamp(),
        duration: await t.computeDuration(),
      })),
    ),
  }
}

/**
 * fMP4 → 普通 MP4（只转封装、不重新编码），边读边写到 FileSystemWritableFileStream，内存占用恒定。
 * moov 在文件末尾（fastStart: false），本地播放完全可拖动。
 */
export async function remuxToMp4(blob, writable, onProgress) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true }),
  })
  const conversion = await Conversion.init({ input, output })
  if (!conversion.isValid) throw new Error(JSON.stringify(conversion.discardedTracks))
  conversion.onProgress = onProgress
  await conversion.execute()
}
