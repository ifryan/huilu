# 请求回放 fixture

单元测试用的服务商响应。结构按 2026-09 的官方文档与 ADR 0004 验证时拿到的真实错误响应整理，
内容为合成数据（不含任何真实 Key、账号或会议内容）。

**它们只证明解析 / 调用顺序 / 错误处理符合文档，不代表真实 API 的格式兼容或性能已验证**；
真实 Key 全流程见 docs/adr/0004「待补测清单」。

- `paraformer-*.json`：百炼临时上传凭证、提交任务、查询任务、识别结果
- `groq-verbose.json`：Groq / OpenAI whisper 的 `verbose_json`
- `chat-summary.json`：OpenAI 兼容 `/chat/completions`，content 为纪要 JSON
