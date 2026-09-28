# Meeting processing and the U-35 data contract

U-34 implements the local queue that transcribes finished recordings, generates a
summary when an LLM is configured, and writes the meeting to the selected folder.
It extends the existing provider and storage packages. The complete result page,
search, exports, and editing are U-35 or later work.

## Runtime and recovery

`apps/extension/entrypoints/offscreen/main.ts` owns the only queue writer. The
service worker reads jobs, creates the offscreen document, and supplies current
service settings and endpoint permission checks. The UI reads jobs and sends
`processMeeting` messages; it must not instantiate another queue writer.

- Jobs live in IndexedDB database `huilu-pipeline`, version 1, store `jobs`, keyed
  by `meetingId`. This is native IndexedDB, independent of the future Dexie index.
- The queue executes one meeting at a time. Steps are `transcribe`, `summarize`,
  and `write`; completed artifacts are reused on retry.
- On document startup, `running` jobs become `queued`. The service worker checks
  for active jobs on startup and on `runtime.onStartup`.
- Offscreen reasons include `USER_MEDIA`, `AUDIO_PLAYBACK`, and `BLOBS`. Cleanup
  requires an idle recorder, no temporary offscreen operations, and no queued or
  running processing job. Delayed retries keep the document alive.
- Transient errors receive up to four attempts, with 20/40/80-second backoff;
  a larger `Retry-After` takes precedence. A manual retry resets the attempt count.
- Paraformer saves its upload URL and task ID. Network/polling failures retain
  the task ID; terminal task failures clear it so an explicit retry can submit
  again using the uploaded file. Region/model changes invalidate its checkpoint.
- Checkpoints reduce duplicate work; they do **not** guarantee exactly-once billing.
  A browser exit after a remote request succeeds but before its local checkpoint
  commits can cause that request to be repeated. OpenAI-compatible transcription
  and LLM calls have no remote task-recovery API in this implementation.

| Job state       | UI meaning and next action                                                 |
| --------------- | -------------------------------------------------------------------------- |
| `queued`        | Pending or backing off; inspect `nextAttemptAt` and `error`                |
| `running`       | Display `step` and optional 0–1 `progress`                                 |
| `waitingFolder` | Results are safe in OPFS; select or authorize the folder in a visible page |
| `failed`        | Show the classified error; fix configuration if needed, then retry         |
| `done`          | Folder write finished; inspect `summary` for a skipped LLM step            |

Do not infer this state from `Meeting.status` alone. That coarse status remains
`processing` while awaiting a folder, becomes `failed` after terminal processing
failure, and becomes `ready` after a successful write. `ready` may mean transcript
only. `job.summary` distinguishes `done` from `skipped`, with reasons
`notConfigured`, `unknownProvider`, `hostPermission`, or `emptyTranscript`.

## Recording and configuration boundaries

Automatic enqueue requires a finished `processing` meeting, `media.audio`, a
nonempty audio track in its manifest, and a configured permitted ASR service.
Unconfigured recordings remain available for preview/download and explicit
backfill. Failed recordings are not automatically queued. Video-only and missing
audio records are rejected by both the UI and queue. An empty transcript skips
the LLM; waveform silence detection is not part of U-34.

The queue uses the existing saved provider configurations. Unknown provider IDs
fail explicitly; no fallback provider is selected. Custom endpoint permission is
requested in the visible settings page, never by the offscreen worker. Keys stay
in `chrome.storage.local`; meeting files and job checkpoints do not store them.
Configuration is resolved at step boundaries, not continuously during a request.
Changing credentials to another account while a Paraformer upload/task is in
flight has not been validated; its upload URLs are account-bound.

## Files to consume in U-35

```text
OPFS /recordings/<meetingId>/
  manifest.json                  recording metadata, MIME, chunk counts/sizes
  meeting.json                   Meeting schemaVersion: 1
  audio/000001.part ...           optional recording chunks
  video/000001.part ...           optional recording chunks
  transcript.json                completed intermediate Transcript
  summary.json                   optional completed intermediate Summary
  pieces/000.json ...             private per-slice retry cache

<selected folder>/<local-date>_<HHmm>_<sanitized-title>[ (N)]/
  .huilu-owner.json               { "id": "<meetingId>" }, internal reservation
  audio.webm                     actual audio container extension may differ
  video.mp4                      optional; actual container extension may differ
  transcript.json
  summary.json                   optional structured summary
  summary.md                     optional readable summary
  meeting.json                   written last, status: ready
```

The collision suffix is appended to the directory name, for example `Title (2)`;
it is not an additional directory level. `job.folderDir` records the chosen name.
Resolve `meeting.id` to `folderDir`; do not reconstruct paths from a mutable title.
Folder ownership is checked again on retry and after the selected root changes.
The reservation prevents a second meeting from adopting a partial write. Unknown
partial artifacts are preserved in place and a different directory is chosen.

U-35 should prefer the authorized data folder for completed meetings and user
edits. OPFS is the fallback for recordings and intermediate results that have not
been written. Do not delete OPFS media or completed intermediate results as part
of a retry. Folder writes skip existing transcripts/summaries and same-size media;
they preserve existing title, markers, and speaker names. This is retry behavior,
not a “regenerate and overwrite” feature. P1 regeneration needs a separate contract.

| Artifact            | Schema and units                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeting.json`      | `@huilu/core` `Meeting`, `schemaVersion: 1`; `durationMs` is milliseconds, `createdAt` is an ISO timestamp; `media.audio` and `media.video` are optional |
| `transcript.json`   | `Transcript`: `language`, `segments[]` with integer `startMs`, `endMs`, string `speakerId`, and `text`; timestamps are relative to recording start       |
| `summary.json`      | `Summary`: `keywords`, `overview`, `chapters`, `speakerSummaries`, `keyPoints`, `actionItems`; chapter `startMs` uses the same timeline                  |
| `summary.md`        | Rendered companion; U-35 should use `summary.json` for the structured guide                                                                              |
| `.huilu-owner.json` | Internal ownership only; its presence does not mark a completed meeting                                                                                  |

Join transcript and summary speaker IDs against `Meeting.speakers[].id` for display
names. Paraformer retains provider speaker IDs as strings; the compatible Whisper
provider uses `"0"` for every segment. Display names are generated in the meeting
language. Chapter timestamps are sorted and clamped to meeting duration; unknown
speaker references and empty entries are removed from summaries. Optional action
item `owner` and `due` are free text, not identifiers or normalized dates.

Only `Meeting` carries a schema version today. `Transcript` and `Summary` follow
their current core Zod schemas. No exported JSON Schema files or U-35 index exist
yet. The in-flight job database contains operational state that cannot be rebuilt
from the final folder alone; do not treat it as disposable while work is pending.

## Provider protocol decisions

Checked against primary sources on 2026-09-28; mocked tests do not establish live
service compatibility, recognition quality, or performance.

- Paraformer uses `GET /api/v1/uploads?action=getPolicy&model=...`, then multipart
  POST to the returned upload host, with the file field last. Credentials are not
  forwarded to the upload or result URL. Uploads are model/account-bound and expire
  after 48 hours; policy lifetime is 300 seconds. The implementation leaves TTL
  margins. This temporary storage is explicitly discouraged for production by
  Alibaba; it remains the accepted v0.1 local-load choice. [Temporary upload API](https://help.aliyun.com/zh/model-studio/get-temporary-file-url).
- Recognition submits JSON to `POST /api/v1/services/audio/asr/transcription`, with
  asynchronous and OSS-resolution headers, and diarization enabled for the mono
  recording. `language_hints` is sent only for `paraformer-v2`. Polling uses `GET
/api/v1/tasks/<id>`. The official REST table says POST but its curl example and
  the official SDK use GET; this discrepancy is preserved here, not hidden by the
  mock. The existing DashScope hostname is still documented as supported.
  [REST reference](https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api),
  [SDK task polling source](https://github.com/dashscope/dashscope-sdk-python/blob/main/dashscope/client/base_api.py).
- Compatible Whisper transcription posts multipart to `{baseUrl}/audio/transcriptions`
  with `verbose_json` and segment timestamps. Groq/OpenAI defaults use Whisper;
  `gpt-4o*` models use JSON and a whole-file segment when timestamps are unavailable.
  Large files use persisted silence-based cuts, sequential requests, cached slice
  results, and absolute timeline offsets. The common limit is conservatively set
  to 25 MiB in code; model/tier-specific limits may differ. [Groq speech API](https://console.groq.com/docs/speech-to-text),
  [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).
- AI SDK 7.0.118 with `@ai-sdk/openai-compatible` 3.0.57 implements the core
  `generateObject` interface using `generateText({ output: Output.json() })`, a
  JSON-schema instruction, and explicit `schema.safeParse`. The wire format is
  `json_object`, supporting providers that do not implement `json_schema`.
  `Output.json()` alone does not validate the Summary shape. [AI SDK Output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output).

## Acceptance boundary

Implementation and local Chromium/mock evidence are recorded in
[U-34 verification](../../docs/U-34-VERIFICATION.md). Real Paraformer/Groq/OpenAI/LLM
requests, speech-recognition quality, a 60-minute Chinese meeting processed within
three minutes, Windows/macOS AAC and CPU measurements, and extension reload or
update permission retention remain untested. Native Linux picker and restart
reauthorization tests narrow the earlier ADR gap but do not establish those other
platform or lifecycle behaviors.
