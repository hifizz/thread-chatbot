# ADR-0006：服务端确定性执行 always，并串行化同一步搜索

- Status: Accepted
- Date: 2026-08-05
- Supersedes: ADR-0001 中“依赖模型 forced tool choice 执行 always”的部分；design D1/D4 的对应实现细节
- Related: `proactive-web-search` spec；GLM-5.2 64-case 路由实测

## Context

2026-08-05 首轮 64-case GLM-5.2 实测出现两个生产阻断问题：

1. Ark Coding Plan 的 GLM-5.2 在 4 个稳定问题上忽略了 AI SDK/OpenAI-compatible `tool_choice` 强制工具选择，`always` 只有 0/4 真正搜索。仅靠 prompt 加强后仍有 1/4 未搜索，不能满足确定性用户覆盖语义。
2. Auto must-search 样例会在同一 model step 并行发出两个查询；虽然请求级硬上限 2 生效，但首轮平均达到 1.79 次，不符合“一次为主”的成本目标。
3. 把 always 首搜结果注入上下文后，如果仍暴露搜索工具，GLM-5.2 会再次搜索，且某次最终输出退化为未解析的字面量 `<tool_call>`，影响答案质量与费用。

这些是实际模型/provider 行为，原设计关于 forced tool choice 可被可靠执行的假设已失效。

## Decision

- `always` 由服务端在第一个模型 step 前直接执行一次受预算、计费和 URL 归一化保护的 Web Search。服务端向 UI 发出标准 tool lifecycle chunks，并以同一 `toolCallId` 将 assistant tool-call/tool-result 注入模型上下文。
- always 的首次搜索完成后，本轮不再向 GLM-5.2 暴露 Web Search；证据不足时模型必须披露限制。这样保证 exactly one provider call，避免重复搜索和 literal tool-call 退化。Markdown Artifact 等其它工具仍可继续使用。
- `auto` 仍由模型主动选择，响应级硬上限保持 2；预算额外增加每个 model step 最多 1 次的门槛。第二次搜索只能在后续 step、模型已经看过首批证据之后发起。
- `off` 语义不变，完全不暴露或执行搜索。

## Alternatives

- 继续只依赖 `tool_choice`：实测失败，不能保证 `always`。
- 只加强 system prompt：从 0/4 改善但仍有 1/4 失败，仍非确定性。
- always 首搜后继续自动开放第二次搜索：实测导致重复调用和字面量 tool-call 输出，弃选。
- 额外调用分类/查询改写模型：会增加一次模型请求、延迟和故障点，MVP 不采用；直接使用最新用户文本作为受长度限制的 query。

## Consequences / Review triggers

always 的查询质量可能低于模型专门改写的 query，但其行为、费用和 UI 状态是确定性的。若 Ark/GLM 后续可靠支持 forced tool choice，或上线独立低成本 query planner，可用新的 ADR 重新评估；不得在无固定路由和真实搜索回归数据时恢复模型强制方案。
