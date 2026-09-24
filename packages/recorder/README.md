# @huilu/recorder

录制管线：来源（标签页 / 窗口 / 屏幕 + 麦克风）→ Web Audio 混音 → 两路 MediaRecorder → 每 5 秒一个分片写入 OPFS。
不依赖 `chrome.*`：采集凭证（streamId）由 `apps/extension/platform/capture.ts` 获取后传入，浏览器能力通过 `MediaBackend` 注入（`browserMediaBackend` 为默认实现，单元测试用假实现）。

## 两路录制

| 轨道    | 内容                         | 编码（按顺序探测，见 ADR 0004）                                        |
| ------- | ---------------------------- | ---------------------------------------------------------------------- |
| `video` | 画面 + 混音（仅视频模式）    | `avc1 + mp4a`（Windows / macOS）→ `avc1 + opus`（Linux）→ `vp9 + opus` |
| `audio` | 混音后的低码率纯音频，转写用 | `audio/webm;codecs=opus`，24kbps                                       |

视频关键帧间隔 1 秒（MP4 只能在关键帧处切分片）。实际使用的 MIME 写进 `meeting.json` 的 `media` 字段。

## OPFS 目录结构（处理管线的输入）

```
recordings/<id>/
├── manifest.json     # 录制状态；每写完一个分片更新一次
├── meeting.json      # 录制结束后生成，status = processing
├── video/000001.part …
└── audio/000001.part …
```

- 分片按编号顺序直接拼接即为完整文件：`RecordingDir.readTrack(track, manifest.tracks[track].chunks, mimeType)`
- 视频拼接结果是分片 MP4（`mvhd.duration = 0`），Chrome / ffmpeg 可正常播放拖动；写入用户文件夹前应由处理管线用 mediabunny 转封装为普通 MP4（ADR 0004 第 3 节）。WebM 音频同样没有时长头
- `manifest.state`：`recording` / `paused` 表示录制中；离屏文档不在录制它却看到这两种状态，说明被意外中断，可通过 `RecorderController.recover()` 以磁盘上的连续分片为准收尾。`stopped` 表示已收尾、等待处理

## 可靠性约定

- 每个分片写完后回读文件大小校验（OPFS 可能写出 0 字节文件却不报错）；任何一片写入失败立即停止录制，已写入的分片保留，之后的分片不再写入
- 同一时间只允许一个录制：`RecorderController.start()` 在第一个 `await` 之前占位
- 来源轨道 `ended`（标签页关闭、停止共享）时自动收尾，`endReason = source-ended`
- 开始录制前检查剩余空间：不足 10 分钟拒绝开始，不足 1 小时给出 `low-storage` 警告
- 麦克风打不开时继续录制并给出 `mic-unavailable` 警告；仅音频模式下既没有来源声音也没有麦克风时拒绝开始
