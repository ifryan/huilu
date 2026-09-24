// 后台只做调度：拿 tabCapture 的 streamId、创建离屏文档、转发消息。录制本身在离屏文档里。

const OFFSCREEN_URL = 'offscreen.html'

// 并发消息共用同一个创建过程，否则会报「Only a single offscreen document may be created」
let creating

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length > 0) return
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
      justification: '录制标签页音视频并分片写入 OPFS',
    })
    .finally(() => (creating = undefined))
  await creating
}

async function toOffscreen(msg) {
  await ensureOffscreen()
  return chrome.runtime.sendMessage({ ...msg, to: 'offscreen' })
}

async function getOptions() {
  const { spikeOptions } = await chrome.storage.local.get('spikeOptions')
  return { source: 'tab', height: 1080, fps: 30, mic: false, ...spikeOptions }
}

// 点击工具栏图标：录制当前标签页（tabCapture 必须由用户在目标标签页上调用插件才能拿到 streamId）
chrome.action.onClicked.addListener(async (tab) => {
  const status = await toOffscreen({ type: 'status' }).catch(() => null)
  if (status?.state === 'recording') {
    await toOffscreen({ type: 'stop' })
    await chrome.action.setBadgeText({ text: '' })
    return
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
  const options = await getOptions()
  const started = await toOffscreen({
    type: 'start',
    options: { ...options, source: 'tab', streamId },
  })
  // 离屏文档把启动失败转成 { error }，不会抛出；只有真正开始录制才显示 REC
  if (started?.state === 'recording') {
    await chrome.action.setBadgeText({ text: 'REC' })
  } else {
    await chrome.action.setBadgeText({ text: 'ERR' })
    console.error('recording failed to start', started)
  }
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.to !== 'background') return
  if (msg.type === 'forward') {
    toOffscreen(msg.payload).then(sendResponse, (e) => sendResponse({ error: String(e) }))
    return true
  }
  if (msg.type === 'closeOffscreen') {
    chrome.offscreen.closeDocument().then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ error: String(e) }),
    )
    return true
  }
})

// 安装 / 重新加载后自动打开验证页面
chrome.runtime.onInstalled.addListener(() => chrome.tabs.create({ url: 'lab.html' }))
