# U-35 results, history, and export — local verification

## Linux 集成到 main（2026-09-28）

PR #7 已合并。PR #8 现以 `main` 为 base，本次合入的远端基线为
`dc8f112cca752812920db307026e6b642e8423f2`，其文件内容与 PR #7 最终 HEAD
`3149f6e40d826273137362b023a4bbf8317565d8` 一致。U-35 原五提交历史完整保留，
使用 merge commit 集成，不变基或强制推送。

唯一文本冲突在 `apps/extension/tests/background.test.ts`：任务存储替身同时保留
读取失败模拟与完成通知依赖的 `get()`。生产代码自动合并后与原 U-35 HEAD 一致。
合并双方回归测试并删除重复用例，保留 main 的 manifest 缺失/损坏/不可读、
转写与 LLM 未注册服务商、授权恢复读取/保存/部分保存失败覆盖，以及 U-35
队列尚未启动时的授权恢复覆盖。新增三项测试验证缺失、运行中和已完成任务的结果通知门控。

本轮完整 `pnpm check` 直接退出码为 **0**，八套测试共 **389 项通过**，测试均实际重跑；
类型检查中仅未变化的 UI 包复用缓存。冲突相关定向测试 **115 项通过**。
首次完整检查因新增测试的类型导入写法不符合 ESLint 失败，修正后完整重跑通过。
本轮 `pnpm build` 直接退出码为 **0**，无缓存构建成功；保留既有非致命 chunk-size 警告。
CI 结果见 [PR #8](https://github.com/ifryan/huilu/pull/8) 和 U-35 最终交付评论。

本轮未重跑浏览器或真实 API 验证；下文为原 MBP 合成数据验证记录，不能视为 Linux 实测。
Linux 构建位于 `/root/org-projects/huilu-worktrees/U-35/apps/extension/.output/chrome-mv3`，
不会更新 MBP 原插件目录。真实用户全流程、系统目录授权持久性、跨平台 AAC 与长会议性能仍待验收。

## MBP 原始交付记录（历史）

Implemented on MBP from the exact pushed U-34 baseline
`22af1ba2b8a9d917da79f0dd804411c00c804654`. PR #7 remains an unmerged dependency;
this branch is `feat/U-35-results-history-export`, with no push, merge, tag, or
release authorization used. A future stacked PR should initially target
`feat/U-34-transcription-summary`, or target `main` after PR #7 is integrated.

## Delivered behavior

- History combines folder meetings with existing OPFS recordings, including
  timestamps, duration, media type, lazy video previews, and processing controls.
  The independent native IndexedDB index is rebuildable from current files.
- Results have editable title and favorite, automatic save on Enter/blur, speaker
  rename/merge, transcript search highlighting and speaker filtering, all guide
  sections, video/native fullscreen and picture-in-picture controls, audio cover,
  shared timeline, ±15 seconds, chapter/marker jumps, and 0.5–3× playback.
- Single-file metadata editing preserves original segments and uses Web Locks,
  stale-field checks, and fixed directory handles. Corrupt text is isolated from
  usable media. Lost folder access cannot substitute stale completed text.
- `@huilu/exporters` implements the core Exporter contract. TXT/SRT/Markdown are
  generated from current data; MP4 is downloaded only after container/track
  validation. M4A is actually encoded as AAC and packaged as MP4 with Mediabunny.
  Unsupported or missing inputs have disabled actions and explanations, with
  original-format download available. No suffix-only conversion occurs.
- Processing completion automatically opens a result once; durable claims survive
  restarts and remain separate from the rebuildable history index.
- New product text is translated in English and Simplified Chinese.

## Automated checks

`pnpm check` and `pnpm build` are run directly, with shell exit codes recorded in
the delivery comment. The suite currently contains 378 tests across eight test
packages. Relevant new cases cover index deletion/rebuild, malformed/duplicate
records, stale and concurrent edits, original speaker data preservation, real
SRT formatting, invalid MP4 rejection, and concurrent completion claims.

## Browser and export evidence

A fresh, isolated Chrome for Testing 153 profile loads the real built extension
at the existing fixed ID `fddknloecifbbeomieckhnegffdobgni`. Tests use 12-second
FFmpeg-generated video/tone and synthetic text. A real OPFS directory handle is
used as the synthetic selected folder: this exercises browser file streams and
IndexedDB persistence, but **does not validate the native OS folder picker**.
Outbound requests are blocked through an unreachable loopback proxy with no
bypass. No provider mock, API configuration, credentials, real meeting, user
profile, screen capture, or microphone capture is used. Browser request logs
contain zero HTTP(S) requests; page error logs are empty on successful runs.

Verified:

- Valid folder records remain visible alongside malformed metadata.
- Chapter click seeks video to four seconds and activates the corresponding
  transcript sentence; keyword search narrows the transcript and highlights it.
- Edited title, speaker name, and merged IDs survive reload.
- Removing the history database and rebuilding retains the edited title.
- TXT, SRT, Markdown, MP4, and M4A downloads complete. `ffprobe` identifies the
  video as MP4 with H.264/AAC (12.000 s), and M4A as MP4 containing AAC audio only
  (12.096 s, including encoder padding). SRT uses actual CRLF delimiters and
  millisecond timestamps. Exported text uses the merged speaker name.
- Video without a declared transcription track disables M4A and text exports.

- Original OPFS-only audio plays with no API configuration.
- Five concurrent completion events open one result; replay after a full isolated
  browser restart opens none. This verifies the real extension completion handler
  and persistent claims with seeded done jobs, not a live API processing run.
- Concurrent stale title edits produce a conflict; changing the selected root
  prevents the old page from editing the new folder's same-ID record.
- Simulated `queryPermission: denied` keeps cached history and blocks fallback to
  stale final data. This is a browser-level permission simulation, not native
  macOS revocation.
- English/Chinese screenshots and a 390px viewport were checked; there is no
  horizontal overflow. No page errors or HTTP(S) requests were observed.

Successful smoke and edge-test outputs and screenshots are attached to U-35.

## New PR #7 review findings checked during U-35

Five new comments arrived at 2026-09-28 08:55 UTC. All were confirmed in the
baseline and fixed **only on this U-35 branch**, without editing PR #7 or its
remote branch:

| Comment    | Finding and local fix                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 4120256397 | A saved queued job could stall after source status-write failure. Always kick in `finally`; regression reaches done after the injected failure. |
| 4120256410 | Startup job-discovery failure was treated as no work. Conservatively wake the offscreen recovery, which already retries storage failures.       |
| 4120256419 | Folder-authorization reconciliation could stop after a failed job save. Reuse startup reconciliation and its retry mechanism.                   |
| 4120256430 | Missing source/manifest could return no media and still commit done. Reject missing source or declared tracks as unavailable.                   |
| 4120256439 | Unknown provider IDs could pass readiness through fallback schemas. Require registration before considering a configuration ready.              |

Each has a targeted regression. Existing processing behavior and provider tests
also run in the full check. Completion callbacks now finish before idle cleanup.

## Manual acceptance on the user's existing installation

1. In `chrome://extensions`, reload the original HuiLu card; keep its existing
   installation, profile, data folder, and recordings.
2. Open History, authorize the existing folder if prompted, and refresh the list.
   Open an old recording and a processed meeting; confirm titles and media.
3. Click a transcript sentence and a chapter, play/pause, skip ±15 seconds, and
   change speed. Verify actual meeting content remains in sync.
4. Edit title and speaker names, press Enter, merge two speakers, then reload.
   Open the same meeting in another tab and verify conflicting edits are reported.
5. Export the applicable formats and open them locally. A non-MP4 recording should
   offer its original format; unsupported M4A must explain why it is unavailable.
6. Complete a user-authorized processing task. Confirm one result tab opens and
   restarting Chrome does not reopen old completed results.

## Acceptance limits

Real screen/microphone recording, paid/provider API calls, recognition quality,
native OS folder authorization and permission retention, Windows/Linux AAC,
long-meeting conversion/memory/CPU, and the complete real recording-to-AI flow
remain for the user's manual acceptance. Earlier ADR/U-34 untested items remain
untested. This delivery is implementation plus a local build, not v0.1 acceptance
or publication. Existing user Chrome was not reloaded or otherwise manipulated.

## Reproduce the synthetic browser checks

With `playwright-core` installed in the existing `spikes` tool environment, its
Chromium browser installed, and FFmpeg available, run from the repository root:

```sh
node spikes/scripts/u35-results-smoke.mjs
node spikes/scripts/u35-results-edges.mjs
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright module; `U35_OUTPUT_DIR`
can select a task-owned artifact directory. Defaults write only under
`output/playwright/u35` (ignored by Git). Smoke creates a fresh profile; edges
reuses that synthetic profile to test persistence. Both close all test browsers
before exiting. Native user profiles are never selected.

Media conversion follows the existing Mediabunny API, checked against its
[codec capability documentation](https://mediabunny.dev/guide/supported-formats-and-codecs)
and [conversion examples](https://mediabunny.dev/guide/quick-start).
