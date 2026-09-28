# U-34 local verification — 2026-09-28

The P0 provider, queue, recovery, folder-write, and History controls are implemented
and locally exercised. This is ready for code review, **not full product acceptance**:
real service compatibility and the 60-minute Chinese meeting / three-minute
processing target remain unverified. U-35 has not been started.

## RH 手测反馈：纪要「余额不足」被当作限流（2026-09-28，MBP 本地，当前增量）

现象：生成纪要时智谱 BigModel 返回 HTTP 429 + `{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}`，
界面显示「请求过于频繁或额度已用完」并定时自动重试。根因：HTTP 与 AI SDK 两条路径都只按状态码分类，
429 一律为 rateLimited（可自动重试）；官方文档中 1113 为 HTTP 429「账户已欠费」。

修复（官方文档依据：智谱错误码、OpenAI error codes、DeepSeek error codes、阿里云百炼错误码）：

- 新增不可自动重试的 `quotaExceeded`，结构化业务码优先于状态码：智谱 1113 / 1309 / 1314，
  OpenAI credit_balance_exhausted、organization/project_spend_limit_exceeded、organization_usage_limit_exceeded，
  百炼 Arrearage、AllocationQuota.FreeTierOnly，以及 HTTP 402。
- 真限流与会重置的窗口（智谱 1302 / 1305 / 1308 / 1310 / 1313 / 1316–1321、百炼 insufficient_quota（其 TPM 限流）、
  普通 429）仍为 rateLimited，按 Retry-After / 退避有限重试；408 / 5xx 语义不变。说明带业务码并去掉 Bearer / sk- 凭据。
- 旧版本已持久化为 rateLimited 且说明含上述业务码的任务：启动恢复时改为 failed / quotaExceeded，
  取消重试计划；认不出的历史错误不改。中间结果保留，手动重试从出错步骤继续，不重新转写。
- 中英文文案：rateLimited 不再写「额度已用完」；quotaExceeded 提示检查服务商账户与 API 配置或更换服务后手动重试。

回归：用户原始响应 fixture（`zhipu-1113-balance.json`）经 AI SDK 与 fetch 两条路径、限流对照、402 / Arrearage / OpenAI 花费上限、
凭据脱敏、旧任务迁移与手动续跑。未做浏览器测试，未调用任何真实 / 付费 API。

## PR #7 第二轮三项审查修复（2026-09-28，MBP 本地，当前增量）

三条新意见（06:46:40 UTC）均核实有效，在 MBP `Ryans-MBP.local` 的
`/Users/ryan/Code/Labs/huilu-worktrees/pr-6` 修复，基线为已推送
`2f6537c810c60f26a76827c65fc3f3efcbe283c1`；新提交未 push，GitHub 线程未改动。

| 评论 ID    | 修复与回归证据                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4119300591 | 启动恢复成功后才标记完成；失败时定时重试，offscreen:process / folderAuthorized 先重新 start()。并发 start 共用一次恢复，部分恢复后不重复退还次数。 |
| 4119300594 | Paraformer 下载结果和构造的 Transcript 运行时校验；缺失、非数字、null、非有限、负值、反向时间戳统一 badResponse；接受零长度、重叠、空结果。        |
| 4119300598 | 所有权探测遇到 TypeMismatchError（候选名是普通文件）视为他人内容并尝试 (2)；IO 错误和权限失效照常失败 / 等待授权，不跳过。                         |

新增回归在修复前代码上失败、修复后通过。MBP `pnpm check` / `pnpm build` 直接退出码均为 **0**，
共 **319** 项测试：core 14、i18n 3、storage 26、recorder 32、providers 106、pipeline 59、extension 79
（未改动的四套复用本机同代码缓存）。本轮按 RH 要求不做浏览器 / 录制测试，由 RH 手动验收；
未调用真实 API。

## PR #7 九项审查修复（2026-09-28，当前增量）

九条意见均核实有效，已在原 U-34 工作树本地修复。基线为已推送
`3c98197732c9b2104d1958020cce9e70cb2a213a`；未 push、未合并、未发布，
GitHub 线程保持 unresolved。以下增量说明优先于下文历史验证记录。

| 评论 ID    | 修复与回归证据                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4119095386 | 可见历史页持续轮询任务（1.5 秒）与录制列表（3 秒）。浏览器覆盖空历史新增、空任务新增、刷新先于激活、done 再激活，均无需焦点切换或再次手动刷新。                       |
| 4119095391 | JSON schema 校验、写入意图日志与文本回读验证；修复空/截断 JSON、Markdown 及静默短写。覆盖初次落盘、ready 会议补纪要中断、合法 JSON/Markdown 编辑保留。                |
| 4119095394 | running 启动恢复退还中断消耗的一次尝试。模拟六次中断后首个 timeout 仍进入自动重试。                                                                                   |
| 4119095398 | SHA-256 绑定有效配置与音频参数；分片再绑定切点。覆盖 model/baseURL/key、切点变化与损坏、配置键顺序不变、旧无绑定断点；未持久化明文密钥。                              |
| 4119095406 | 响应运行时校验后再解析 Transcript。覆盖缺失、字符串/null、非有限、负值、反向/乱序时间戳；接受零长度、重叠、空结果与 text-only 兼容响应。                              |
| 4119095410 | 后台启动唤醒等待任务，离屏队列按实际 handle 权限决定继续；不申请权限。单测和浏览器覆盖已授权但没有 watcher 事件、缓存授权标记过期且实际无 handle。                    |
| 4119095413 | 完成目录是补纪要的权威来源，使用用户修改的逐字稿、标题与发言人。权限失效等待；换目录、缺失/损坏或归属错误明确失败。覆盖生成中再次编辑、失败后修改输入、编辑结果保留。 |
| 4119095418 | 新增 isDirectoryEmpty，通过枚举证明未归属目录为空。覆盖 notes.md、其他媒体后缀、空子目录和目录位置被文件占用。                                                        |
| 4119095424 | HTTP 408 映射 timeout；provider HTTP 回放与队列自动退避回归，与 400/401/403/404 终态分类对照。                                                                        |

代码提交（相对已推送基线）：`d59c3f6`、`995f7a7`、`9d922e5`、`a42a5e3`、`de14f15`。
最终 `pnpm check` / `pnpm build` 直接退出码均为 **0**。共 **302** 项测试：
core 14、i18n 3、storage 26、recorder 32、providers 95、pipeline 53、extension 79。
最后一轮仅 extension 重新测试，其余六套复用本轮代码对应的成功缓存；构建无缓存。
构建仍有既有非致命 chunk-size warning（最大约 588 kB）。

浏览器验证代码版本为 `de14f15`：Linux、Chromium 145.0.7632.6，1280×720，
独立 `/tmp` profile。Browser plugin 不可用，使用已安装 Playwright Core。
页面 `chrome-extension://fddknloecifbbeomieckhnegffdobgni/app.html#/`，标题 HuiLu；
非空、无框架错误覆盖层、无 console/page error，截图已检查。
空历史新增约 2.57 秒、空任务新增约 1.49 秒自动呈现；重启后 waitingFolder
在实际 granted handle 下完成，在实际无 handle/缓存仍称已授权时继续等待并关闭空闲 offscreen。
测试只有一次本地 HTTPS mock ASR 请求，未录屏、未读真实会议、未调用付费 API。
音频为 20 字节合成网络夹具，不是可解码录音；本轮不重复验证录制/编码。

文件夹使用持久化的真实 **OPFS DirectoryHandle 作为测试替身**，实际调用
queryPermission 与存储适配器，未重测原生目录选择/授权弹窗。授权刷新竞态由
两个独立扩展页面在可见页刷新后延迟修改 IndexedDB 重现；不是一次原生授权操作。
本轮是完整浏览器重启，未单独强杀 Service Worker。两个早期测试脚本文案断言错误
已修正，失败报告保留，未计为通过。

证据（报告、截图、DOM 文本、脚本和命令日志）：

```text
/root/org-projects/huilu-worktrees/U-34-e2e/out/pr7-review-1790576987895/
  report.json
  u34-review-browser.mjs
  u34-review-check.log
  u34-review-build.log
  startup-reconciled.png
  external-new-job.png
  refresh-before-activation.png
  stale-authorization-cache.png
  harness-failure-*.json
```

mock Preview ID `0765057c6891251f15522b89` 已停止；所有测试浏览器进程均已关闭。
交付前重读 PR comments/reviews，仍为上述九条、无新增。真实 API、跨账户真实上传、
Windows/macOS、60 分钟会议性能与原生授权边界仍未验收。
旧无配置绑定的未完成转写断点会被安全失效，可能重新调用服务；已完成逐字稿不因改配置重转写。
远端成功/本地尚未持久化的崩溃窗口仍无法保证恰好一次计费。

## Revisions and checks

- Source: `/root/org-projects/huilu-worktrees/U-34`, branch
  `feat/U-34-transcription-summary`, on `origin/main` at
  `045ecb5ec54337abca3a3935e5e32932a5bc6082`.
- Preserved implementation: `6159d80`, `3f695f8`, `f90e0e7`, `abb265a`.
- Review fixes: `0360306` (Paraformer terminal-task retry and model-specific
  language hints), `0284adb` (folder ownership across partial writes and root changes).
- Prior run `01a0e627-9547-75ec-8b35-272921095725`, message 204, records direct
  `check_exit=0` and `build_exit=0`: storage 25, recorder 32, i18n 3, core 14,
  providers 72, pipeline 25, extension 77 = **248 tests**. This is historical
  evidence; it did not establish a browser integration pass.
- Final `pnpm check`: direct exit **0**. Providers **74** and pipeline **28**
  reran; the five unchanged package suites were Turbo cache hits, for **253**
  total passing tests. Final `pnpm build --force`: direct exit **0**, uncached,
  with a nonfatal chunk-size warning (largest chunk 584.89 kB). This production
  rebuild removed the generated slicing test helper. Logs: `final-check.log` and
  `final-build.log` in the evidence directory below.

## Browser environment and evidence

Linux / `ryan-ubuntu`, Chromium **145.0.7632.6**, existing Playwright Core harness.
The Browser plugin was unavailable. Independent persistent Chromium profile;
extension ID `fddknloecifbbeomieckhnegffdobgni`. The synthetic source was a local
canvas animation and generated tone, with microphone capture disabled. No user
screen, real meeting, real API key, or paid API was used.

Real Chromium HTTPS requests were directed to a loopback mock by host-resolution
rules; all other hostnames were blocked. Synthetic bearer credentials were checked
at the mock. Upload/result requests were checked for absence of bearer credentials.
The mock validates multipart fields, file-last OSS upload, ASR submission headers,
GET polling, and JSON summary responses. It is not evidence of remote service
acceptance, recognition accuracy, diarization quality, or model performance.

```text
/root/org-projects/huilu-worktrees/U-34-e2e/
  mock.mjs, integration.mjs, more.mjs, split-only.mjs
  headed-wrapper.mjs, split-browser.ts
  out/integration-1790570387585/
    report.json                 main suite, pass: true
    more-report.json            targeted fix/config passes; helper failure below
    split-report.json           corrected slicing helper, pass: true
    final-check.log
    final-build.log
    waiting-folder.png
    completed.png
    retrying.png
    history-final.png
    history-narrow.png
    terminal-failure.png
    data-folder/                actual native File System Access output
```

The initial full capture ran on `abb265a`. Remaining main-suite cases and the
targeted checks ran after rebuilding `0284adb`. Harness interruptions from native
dialog placement and strict Playwright locators were resumed against the same
synthetic recording; the recording was not recreated or presented as a fresh
complete rerun on the final revision.

`more-report.json` deliberately retains its failure: loading an independent bundle
through CDP evaluation let Zod's initial eval-capability probe disagree with the
extension CSP on a later asynchronous call. The corrected helper was loaded as a
local extension script under the existing CSP, and `split-report.json` records
the successful run. Production CSP and source were unchanged. The final build
removes this temporary generated helper from the extension output.

The mock used managed Preview ID `0765057c6891251f15522b89` on local ports
18080/18443. It is stopped at handoff. Browser processes and the temporary virtual
display were awaited and closed after each run.

## Observed results

| Scenario                               | Result and evidence boundary                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Record → ASR → summary → native folder | **35,064 ms** real synthetic tab recording; audio 68,653 bytes, video 2,840,108 bytes. Native picker selected the output folder. Six final artifacts written: audio, video, transcript JSON, summary JSON/Markdown, ready meeting JSON. Mock transcript has two speakers and summary has all six guide sections.                                                                                                               |
| Offscreen lifetime                     | Remained alive during 33 seconds of silent processing while the mock task stayed running; closed when processing finished.                                                                                                                                                                                                                                                                                                     |
| Browser restart                        | Closed/relaunched Chromium after the remote task ID was persisted. Recovered to `waitingFolder`, with one upload and one submission total.                                                                                                                                                                                                                                                                                     |
| Folder authorization                   | Waited for native folder selection, then completed. On a later restart, actual visible-page native reauthorization succeeded and the saved handle became writable.                                                                                                                                                                                                                                                             |
| Unconfigured recording / backfill      | Recorded without API configuration; no job started. History's Transcribe & summarize action later completed compatible ASR. Adding an LLM and choosing Create summary reused the transcript; no second ASR request.                                                                                                                                                                                                            |
| Compatible provider                    | Groq preset, multipart `verbose_json`, one speaker; real request serialization and local mock response.                                                                                                                                                                                                                                                                                                                        |
| Automatic retry                        | 429 produced queued backoff, then succeeded on attempt 2 after the configured 20-second delay.                                                                                                                                                                                                                                                                                                                                 |
| Invalid summary                        | Invalid object shape rejected; automatic summary retry succeeded and reused the completed transcript.                                                                                                                                                                                                                                                                                                                          |
| Missing audio / video-only             | Clones of the real recording with meeting audio or manifest audio removed returned `noAudio`, with no job. This is fixture-based browser integration, not a new live silent-screen capture.                                                                                                                                                                                                                                    |
| Terminal Paraformer failure            | `taskFailed`, then History Retry: one upload, two task submissions, successful output including the matching ownership marker.                                                                                                                                                                                                                                                                                                 |
| Unknown provider / endpoint permission | Failed as `unknownProvider` / `hostPermission`; zero network requests for both. No provider fallback.                                                                                                                                                                                                                                                                                                                          |
| Real WebCodecs slicing                 | An isolated queue used the production splitter/provider/storage, forcing a 25,000-byte cap on the 68,653-byte recording. Seven mono Opus pieces, 5,546–18,217 bytes; decoded durations within 0.1 s of requested cuts. All seven local-mock transcript starts matched absolute offsets (250, 3939, 6931, 9960, 17910, 20926, 24933 ms). This verifies mechanics, not large-file throughput or natural-speech boundary quality. |
| Visible UI                             | History inspected at 1280×720 and 640×900, including waiting-folder, completed, retry and failure states. Main suite captured no console warnings/errors or page errors. Full result-page UX belongs to U-35.                                                                                                                                                                                                                  |

## Defects repaired

1. A terminal Paraformer failure left its task ID in the checkpoint, so manual
   retry polled the same failed task forever. Terminal failures now discard that
   ID while retaining an unexpired upload URL. Network failures still reuse their
   task ID. Language hints are limited to `paraformer-v2` per the current reference.
2. A cached output directory could be reused after the selected root changed,
   overwriting a different meeting; a partial write without `meeting.json` could
   also be adopted by another job. The writer now checks ownership every attempt,
   reserves a directory before writing media, and picks a collision suffix for
   foreign or unknown partial data. Three regressions cover root change, partial
   reservation, and preservation of an unowned partial transcript. Native browser
   output verifies the reservation is actually written; root-change fault cases
   are unit tests rather than native-picker tests.

## Remaining acceptance work and limits

- Real Paraformer/Groq/OpenAI/LLM requests, provider MIME acceptance, multilingual
  recognition and speaker separation; no claims based on mock text or tones.
- A 60-minute Chinese meeting processed within three minutes, large-file CPU/RAM,
  real-speech silence boundary quality, and Windows/macOS AAC/CPU.
- Extension reload/update permission retention, cross-platform folder permissions,
  and forced service-worker termination independently of a full browser restart.
- Real cross-account Paraformer behavior remains untested. The PR #7 fixes above
  now invalidate checkpoints on credential changes at the next attempt; an active
  request continues using its captured configuration.
- Exactly-once billing cannot be guaranteed across the remote-success/local-save
  crash window. Saved task IDs and intermediate results prevent duplicates in the
  exercised recovery paths; this does not prove every possible crash boundary.
- No waveform-level silence detector is implemented. Missing/absent audio is
  rejected; an actual audio track containing silence can still be sent to ASR.
- U-35 result display, edits, search and exports are outside this delivery.

The [pipeline README](../packages/pipeline/README.md) is the U-35 data contract and
contains the primary-source API references, including the REST-table/SDK polling
method discrepancy and the AI SDK structured-output validation boundary.
