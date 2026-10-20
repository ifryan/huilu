/**
 * 页面内录制的存储端：以隐藏 iframe 嵌在被录制的网页里，把分片写进插件自己的 OPFS（见 lib/recorder-sink）。
 * 网页也能嵌入这个页面，所以端口要先经后台校验令牌才会被接受。
 */
import { RecordingStore, browserMediaBackend } from '@huilu/recorder'
import { sendMessage } from '@/lib/messaging'
import { SINK_HELLO, serveRecordingSink } from '@/lib/recorder-sink'

const store = new RecordingStore(() => navigator.storage.getDirectory())
let served = false

window.addEventListener('message', (event: MessageEvent<{ type?: string; token?: string }>) => {
  const [port] = event.ports
  if (served || event.data?.type !== SINK_HELLO || !port || typeof event.data.token !== 'string')
    return
  void sendMessage('verifyRecorderSink', event.data.token).then((ok) => {
    if (!ok || served) return port.close()
    served = true
    serveRecordingSink(port, store, () => browserMediaBackend.availableBytes!())
    port.postMessage({ ready: true })
  })
})
