import { useEffect, useRef, useState } from 'react'

import { levelFromSamples, smoothLevel } from '@huilu/recorder'
export { levelFromSamples, smoothLevel } from '@huilu/recorder'

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
