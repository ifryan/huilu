# ADR 0004：v0.1 技术验证结论（文件夹授权、长时录制、MP4、转写调用链路）

- 状态：已接受（2026-09-24）；验证项 1 的 Chrome 实机清单、验证项 4 的真实 Key 全流程待补测，不影响下述实现方案
- 验证代码：`spikes/`（复现方式见 `spikes/README.md`），对应 PRD 8.1

## 验证环境

- Chrome for Testing 145.0.7632.6（Linux x64，`--headless=new` 加载真实插件），12 核 / 45GB 内存，**软件渲染 + 软件编码**（无 GPU）
- 录制在**离屏文档**中进行，来源为合成画面：1080p/30fps 画布，每帧绘制 40 个移动色块模拟屏幕共享的画面变化；每秒整点同时「闪白 + 1kHz 哔声 100ms」，用于离线测音画同步
- 视频码率 4Mbps（1080p）/ 2.5Mbps（720p），转写音频 Opus 24kbps；MediaRecorder `timeslice = 5000ms`，每个分片写成 OPFS 中的独立文件

## 结论一览

| #   | 验证项                   | 结论                                                                                                                                                              |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 文件夹授权持久性         | **可行，但不能依赖授权一直有效**。录制期间只写 OPFS，结束后再写入用户文件夹；授权失效时进入「待写入」，由可见页面重新授权后补写                                   |
| 2   | 长时间录制               | **可行**。{{SOAK_SUMMARY}}                                                                                                                                        |
| 3   | MediaRecorder 直接出 MP4 | **可行**。H.264 各平台可用；AAC 只有 Windows / macOS 有，Linux 退回 Opus。输出为分片 MP4（fMP4），结束时用 mediabunny 流式转封装为普通 MP4。音画偏移中位数 < 35ms |
| 4   | 百炼 / Groq 调用链路     | **可行**。插件源下两家接口均无 CORS 问题；百炼「临时上传 → oss:// → 异步识别 → 轮询」已实现；Groq 25MB 限制用 24kbps 音频 + 静音点切片解决                        |

## 1. File System Access 授权持久性

### 验证结果

- 句柄存入 IndexedDB 后，插件网页、离屏文档同源（`chrome-extension://<id>`），**都能读到同一个句柄**
- 无头环境无法自动操作文件夹选择器（CDP `Page.setInterceptFileChooserDialog` 会直接让 `showDirectoryPicker` 抛 `AbortError`），因此 Chrome 实机行为改为人工清单（`spikes/README.md`「验证项 1」），`lab.html` 每次打开都会记录 `queryPermission` 结果
- 已知的文档化行为（Chrome 122+ 持久化权限）：
  - 首次通过选择器授予的是**本次会话**权限；「每次访问时都允许」三选项**只在之后对已存句柄调用 `requestPermission()` 时出现**，不会出现在第一次选择时
  - 选了「每次访问时都允许」后，重启浏览器 `queryPermission()` 直接返回 `granted`；用户可在网站设置里逐个撤销
  - 官方文档未说明 `chrome-extension://` 源的行为；社区反馈（2023，Chrome 122 之前）插件**更新 / 重新加载后授权会被清掉**，需实机确认（清单第 7 步）
- 离屏文档**没有用户激活**，`requestPermission()` 在其中必然失败；它只能在 `queryPermission()` 为 `granted` 时直接写

### 推荐实现

1. 录制中所有数据只写 OPFS（不需要授权、最稳）；结束后由离屏文档把成品整理写入用户文件夹
2. 写入前 `queryPermission()`：不是 `granted` 就把任务标为「待写入」，并在弹窗 / 侧边栏 / 插件网页顶部显示「一键重新授权」；授权动作必须发生在可见页面的点击事件里（有用户激活），授权后通知离屏文档补写
3. 首次引导：选择文件夹后立即提示用户「下次浏览器重启后会再问一次，请选择『每次访问时都允许』」，不要承诺第一次就能选「始终允许」
4. 「开始录制」**不因文件夹未授权而置灰**：录制只依赖 OPFS，授权只影响最终写入

### 对 PRD 的影响

- F0.3「引导用户选择『始终允许』」改为：首次选择后说明「重启后首次使用需确认一次，请选择每次访问时都允许」
- F1.10「数据文件夹未授权时置灰」改为：允许录制，结束后若未授权进入「待写入」并提示重新授权（与 ARCHITECTURE 第 4 节一致）
- 插件升级（重新加载已解压的扩展程序）可能清掉授权，Release 说明里需提示

## 2. 长时间录制

### 验证结果

{{SOAK_TABLE}}

- 分片完整性：录制结束后逐个比对 OPFS 中分片的数量与大小，与录制时记录的完全一致；5 分钟 1080p：视频 50 片 / 78.5MB、音频 60 片，均无缺失、无写入错误；单个分片写入 OPFS 最长 23ms
- JS 堆始终 ~4MB，不随时长增长：分片拿到后立即写盘、不在内存中累积，Blob 由浏览器托管
- 离屏文档所在的插件 renderer 进程承担几乎全部负载（软件编码下约 1.1 核、RSS ~280MB），浏览器全部进程 RSS 合计 ~1.2GB 且平稳
- **视频分片间隔默认不是 5 秒**：Chrome 的 MP4 封装只能在关键帧处切分片，默认关键帧间隔不固定（1–2 秒且会拉长），实测视频分片平均 ~6 秒、最长间隔 11 秒（720p/15fps 与 1080p/30fps 都出现）。设置 MediaRecorder 的 `videoKeyFrameIntervalDuration: 1000` 后关键帧稳定在 ~1.05 秒，最长间隔降到 5.4 秒。音频（WebM）始终严格 5 秒
- 720p/15fps（PRD 的 CPU 参考档位）：插件 renderer 进程约 41% 单核（本机 12 核，相当于整机约 3.4%），RSS ~230MB；1080p/30fps 约 110% 单核
- 以上 CPU 数据来自**无 GPU 的软件编码**，只能说明「不会失控」，不能代表用户机器上的真实占用；PRD 的「720p/15fps CPU ≤ 20%」需在 Windows / macOS 实机用 Chrome 任务管理器测（`spikes/README.md` 验证项 2 / 3）

### 推荐实现

- 保持「离屏文档 + 每 5 秒一个独立分片文件」：崩溃后已写完的分片都可用，按序拼接即可恢复
- 视频 MediaRecorder 设置 `videoKeyFrameIntervalDuration: 1000`，保证视频分片也接近 5 秒
- 两路录制：视频轨（H.264 + AAC/Opus）+ 转写音频轨（Opus 24kbps，约 10.5MB/小时）
- 录制状态、分片计数定期写入 OPFS（spike 中每 10 秒写一次 `stats.json`），用于「恢复未完成的录制」
- 监听视频轨 `ended`（标签页关闭 / 共享结束）自动收尾
- 麦克风：离屏文档不能弹授权框，需要先在可见的插件页面里 `getUserMedia` 授权一次，之后离屏文档可直接使用（已验证混音链路）
- tabCapture 会让标签页静音，采集到的标签页音频要同时接到 `AudioContext.destination` 播回给用户

### 对 PRD 的影响

- 第 7 节「分片每 5 秒落盘，崩溃最多丢失 5 秒」可以保留，前提是设置关键帧间隔（否则视频最多丢失约 11 秒）
- CPU 指标保留，但以实机测量为准

## 3. MediaRecorder 直接输出 MP4

### 验证结果

- `isTypeSupported`（Chrome 145 Linux）：`video/mp4;codecs=avc1(.640028)` ✅、`avc1,opus` ✅、`avc1,mp4a` / `mp4a.40.2` ❌、`vp9,opus` / `av01,opus`（MP4 内）✅、`audio/webm;codecs=opus` ✅
  - Chrome 的 MediaRecorder AAC 编码依赖系统编码器，**只有 Windows / macOS 有**；Linux 只能 H.264 + Opus
  - Windows / macOS 实机的支持矩阵可在 `lab.html` 的格式下拉框里直接看到（待实机确认）
- 输出结构：`ftyp + moov + (moof + mdat)×N` 的**分片 MP4**，`mvhd.duration = 0`，没有 `sidx` / `mfra` 索引
  - 分片按顺序直接拼接即得到完整文件；Chrome `<video>` 与 ffmpeg 能扫描出正确时长并正常拖动（1080p 5 分钟：拖动到 10% / 50% / 90% 落点精确，每次 ≤ 35ms）
  - 但系统播放器、剪辑软件对 duration = 0 的 fMP4 兼容性不可靠
- 用 mediabunny（MPL-2.0，纯 JS）把 fMP4 **只转封装、不重新编码**为普通 MP4（moov 在尾部）：边读边写，内存恒定；1080p 5 分钟 75MB 耗时 0.33 秒；转封装前后解码 0 错误、时长一致
- 音画同步（闪白帧 vs 哔声起点，每个窗口 30 对）：

| 录制                   | 开头 30 秒 中位 / 范围 | 中段         | 结尾        |
| ---------------------- | ---------------------- | ------------ | ----------- |
| 720p · 1 分钟          | 22ms / −28 ~ 59        | 25 / −27~55  | 31 / −27~60 |
| 1080p · 5 分钟         | −2ms / −29 ~ 44        | 6 / −42~43   | 5 / −54~39  |
| 720p · 1 分钟 + 麦克风 | −33ms / −68 ~ 24       | −31 / −68~23 | −28 / −68~5 |
{{SOAK_AVSYNC_ROW}}

范围里包含合成源本身约 ±1 帧（33ms）的生成误差；全部远低于 PRD 的 200ms，且没有随时长漂移

- 转写音频轨（`audio/webm;codecs=opus`）：WebM 头里**没有时长**（`<video>` 报 `Infinity`，ffprobe 报 N/A），需要拖到末尾才能算出；首个 Opus 包 ffmpeg 报一次解析错误（约 20ms，不影响转写）

### 推荐实现

- 视频格式按顺序探测：`avc1.640028,mp4a.40.2` → `avc1,mp4a` → `avc1.640028,opus` → `avc1,opus` → `vp9,opus`（WebM）；实际使用的 MIME 写进 `meeting.json`
- 结束时由离屏文档用 mediabunny 把 OPFS 分片流式转封装为普通 `video.mp4` 写入数据文件夹；`audio.webm` 同样转封装补上时长
- 结果页播放直接用 `<video>`，无需额外处理
- Linux 用户得到 H.264 + Opus 的 MP4：Chrome、VLC、ffmpeg 可播，QuickTime / Windows「照片」可能不支持 Opus，导出时提示

### 对 PRD 的影响

- F3.14「音频 M4A」：AAC 编码同样依赖系统编码器（WebCodecs 也一样），Linux 上改为导出 Opus（`.webm` / `.ogg`）；Windows / macOS 可用 WebCodecs 编成 AAC 再封装为 M4A
- 新增依赖 mediabunny（MPL-2.0，与 AGPL-3.0 兼容），放在 `packages/recorder` / `packages/exporters`

## 4. 转写调用链路

### 百炼 Paraformer

- 流程（`spikes/extension/lib/dashscope.js`，插件页面与离屏文档共用）：
  1. `GET /api/v1/uploads?action=getPolicy&model=paraformer-v2` 取上传凭证
  2. 按凭证把文件 `POST` 到 `upload_host`（OSS 表单上传，`file` 必须是最后一个字段），得到 `oss://<upload_dir>/<文件名>`
  3. `POST /api/v1/services/audio/asr/transcription`，请求头 `X-DashScope-Async: enable` + `X-DashScope-OssResourceResolve: enable`，参数 `diarization_enabled: true`、`language_hints: ['zh','en']`
  4. `GET /api/v1/tasks/{task_id}` 每 3 秒轮询，成功后下载 `transcription_url`（24 小时有效）里的 JSON，`sentences[].{begin_time,end_time,text,speaker_id}` 直接映射为 `core` 的 `TranscriptSegment`
- 已验证：插件源（`chrome-extension://`）下请求百炼接口正常返回业务 JSON（无效 Key 时 401 `InvalidApiKey`），**不存在 CORS 问题**；OSS 上传与结果下载域名均为 `*.aliyuncs.com`，已在 `host_permissions` 中声明
- 未验证：本环境没有百炼 Key，上传 → 识别 → 取结果的真实全流程待补测：`DASHSCOPE_API_KEY=sk-... node spikes/scripts/transcribe.mjs --provider paraformer --file <会议音频>`，或在 `lab.html` 里点「百炼（离屏文档）」
- 限制与风险：
  - 临时文件 48 小时有效，**与上传账号、模型绑定**（`getPolicy` 的 `model` 必须与识别用的模型一致），上传凭证 5 分钟过期
  - 官方说明临时上传「不建议用于生产」，属于便利接口，可能变更；备选是用户自配 OSS Bucket（v0.2）
  - 发言人区分只支持单声道；我们的转写音频本身就是混音后的单轨
  - 国际站使用 `dashscope-intl.aliyuncs.com`，设置里提供地域选项

### Groq（OpenAI 兼容）

- `POST {baseUrl}/audio/transcriptions`，`model=whisper-large-v3-turbo`、`response_format=verbose_json`、`timestamp_granularities[]=segment`；支持 webm，免费档单文件 25MB，最少按 10 秒计费；无发言人区分
- 插件源下请求正常返回 401 JSON（无效 Key），无 CORS 问题；真实转写待有 Key 后补测
- **25MB 基本不用切**：转写音频用 Opus 24kbps，约 10.5MB/小时，2 小时以内都不超限
- 超限时按静音点切片（`spikes/extension/lib/split.js`）：按平均码率估算每片时长（留 10% 余量），只在每个理想切点前 20 秒的窗口里解码、找能量最低的 0.4 秒作为切点，再用 mediabunny 截取成独立 WebM，识别结果按切片起点偏移后合并
  - 实测：40 分钟音频（7.6MB）按 2MB 上限强制切成 5 片，全部 ≤ 2MB，**4 个切点全部落在静音段中间**，各片时长之和 = 2400.00 秒，总耗时 8.8 秒
  - 截取时 mediabunny 会重新编码，必须显式指定与原文件相同的码率，否则切片反而更大（踩过的坑）

### 对 PRD 的影响

- 「单文件 ≤ 25MB（超出自动切片）」保留，并注明默认的转写音频码率下 2 小时以内不会触发
- 5.2 节服务商表格中百炼一行补充「临时文件 48 小时有效、不建议生产使用；备选用户自配 OSS」

## 待补测清单

| 项目                                      | 方法                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| 文件夹授权：重启、重新加载插件后的表现    | `lab.html` + `spikes/README.md` 验证项 1 清单              |
| Windows / macOS 的 MIME 支持（AAC）与 CPU | `lab.html` 格式下拉框；工具栏图标录真实标签页 + 任务管理器 |
| 百炼真实全流程（含发言人区分）            | `scripts/transcribe.mjs --provider paraformer`             |
| Groq 真实转写                             | `scripts/transcribe.mjs --provider groq`                   |
