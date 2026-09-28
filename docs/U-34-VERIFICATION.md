# U-34 local verification — 2026-09-28

The P0 provider, queue, recovery, folder-write, and History controls are implemented
and locally exercised. This is ready for code review, **not full product acceptance**:
real service compatibility and the 60-minute Chinese meeting / three-minute
processing target remain unverified. U-35 has not been started.

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
- Switching the API key to another account during an in-flight Paraformer task.
  Checkpoints bind region/model, not account; temporary uploads are account-bound.
- Exactly-once billing cannot be guaranteed across the remote-success/local-save
  crash window. Saved task IDs and intermediate results prevent duplicates in the
  exercised recovery paths; this does not prove every possible crash boundary.
- No waveform-level silence detector is implemented. Missing/absent audio is
  rejected; an actual audio track containing silence can still be sent to ASR.
- U-35 result display, edits, search and exports are outside this delivery.

The [pipeline README](../packages/pipeline/README.md) is the U-35 data contract and
contains the primary-source API references, including the REST-table/SDK polling
method discrepancy and the AI SDK structured-output validation boundary.
