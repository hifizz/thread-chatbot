# 冰岛线路显式缓存受控验证

验证时间：2026-09-05 17:27:48–17:27:57 UTC（新加坡时间 2026-09-06 01:27）。

使用当前 `lib/ai/llm` 注册入口及 Anthropic SDK；`actualProvider=iceland-relay`、`protocol=anthropic`。每个模型使用独立 UUID 开头的合成前缀，长度均为 64,986 字符；每个模型连续两次相同请求。System 末尾添加 `ephemeral/5m` 缓存控制，关闭推理，输出上限 16 Token，不自动重试。不发送项目文档、用户消息或附件。

| 模型 | 次数 | 输入总 Token | 未缓存 | 缓存写入 | 缓存读取 | 输出 Token | 结束原因 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| claude-opus-5 | 1 | 30,985 | 11 | 30,974 | 0 | 0 | content-filter |
| claude-opus-5 | 2 | 30,985 | 11 | 30,974 | 0 | 0 | content-filter |
| claude-sonnet-5 | 1 | 30,982 | 11 | 30,971 | 0 | 4 | stop |
| claude-sonnet-5 | 2 | 30,982 | 11 | 0 | 30,971 | 4 | stop |

原始响应 `usage` 的 `input_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` / `output_tokens` 分别为：

```json
{
  "opus-1": {"input_tokens":11,"cache_creation_input_tokens":30974,"cache_read_input_tokens":0,"output_tokens":0},
  "opus-2": {"input_tokens":11,"cache_creation_input_tokens":30974,"cache_read_input_tokens":0,"output_tokens":0},
  "sonnet-1": {"input_tokens":11,"cache_creation_input_tokens":30971,"cache_read_input_tokens":0,"output_tokens":4},
  "sonnet-2": {"input_tokens":11,"cache_creation_input_tokens":0,"cache_read_input_tokens":30971,"output_tokens":4}
}
```

SDK 标准字段与原始字段一致。实验 ID：Opus 为 `ec217232-bb70-4ae6-a76f-46119d6adcb4`；Sonnet 为 `678f0659-78a3-4caf-b916-2889de29c141`。

## 决定与限制

- 仅开启 `iceland-relay / anthropic / claude-sonnet-5` 的显式缓存。两次请求正常结束，已观察到首次写入和随后读取。
- Opus 两次均报告写入，但未观察到读取，且返回 `content-filter`、没有正文。暂不启用，后续需调查正常生成及缓存读取；当前证据不能确定过滤原因，也不能归因于缓存。
- 这些是中继返回的用量证据，无法独立核实中继内部节点、底层模型或计费。两次请求不证明稳定命中率、TTL 到期行为、多步工具及图片场景。
- 此结果取代旧 UMAPIS 白名单作为当前运行时策略依据；原 OpenSpec 中的 UMAPIS 目标保留为历史设计，不能据此将全部发布验证任务标为完成。

## 复现

手动运行 `scripts/probe-prompt-cache.ts`，通过 Node 的 `--env-file` 指定含冰岛配置的本地文件。该脚本最多发送四次付费请求，不加入 CI；仅打印实验身份、时间、结束原因及标准/原始用量，不输出密钥、地址和正文。普通 CI 使用 `pnpm test:thread-chat:prompt-cache` 的无网络测试。
