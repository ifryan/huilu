// Worker 中的定时器不受隐藏文档节流影响，用来驱动合成画面
let timer
onmessage = ({ data }) => {
  clearInterval(timer)
  timer = setInterval(() => postMessage(0), data.intervalMs)
}
