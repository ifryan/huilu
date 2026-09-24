import { useEffect, useRef, useState } from 'react'

/** 电平条下限：-60 dBFS 以下视为静音 */
const FLOOR_DB = -60
/** 每帧最多回落的比例，避免电平条随每一帧跳动 */
const DECAY_PER_FRAME = 0.04

/** 一帧采样（-1…1）的 RMS 电平，按 dBFS 映射到 0…1 */
export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) sum += s * s
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

/** 上升立即跟随，下降按固定速度回落 */
export function smoothLevel(previous: number, next: number): number {
  return next >= previous ? next : Math.max(next, previous - DECAY_PER_FRAME)
}

export type MicPreviewState = 'idle' | 'running' | 'failed'

/**
 * 麦克风电平预览（PRD F1.6）：只在可见页面、已授权时打开麦克风，不会触发授权弹窗以外的副作用。
 * 电平直接写到 meterRef 的样式上，避免每帧重新渲染；停用、换设备或卸载时关闭麦克风。
 */
export function useMicLevel(active: boolean, deviceId: string | undefined) {
  const meterRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MicPreviewState>('idle')

  useEffect(() => {
    if (!active) {
      setState('idle')
      return
    }
    let cancelled = false
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let frame = 0

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        })
      } catch {
        if (!cancelled) setState('failed')
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      let level = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(samples)
        level = smoothLevel(level, levelFromSamples(samples))
        if (meterRef.current) meterRef.current.style.width = `${Math.round(level * 100)}%`
        frame = requestAnimationFrame(tick)
      }
      setState('running')
      tick()
    }
    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close()
    }
  }, [active, deviceId])

  return { meterRef, state }
}
