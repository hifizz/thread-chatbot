# 事故报告：可恢复工具错误导致完整回复被标记为 failed

日期：2026-08-27

## 摘要

ThreadChat 中出现了一条用户可见已经生成完成、参考来源也已展示完整，但消息底部仍显示“生成过程中发生错误，点击重试”的回复。

经数据库核查，该问题不是前端渲染误判，而是 assistant Message 行本身被持久化为错误终态：

```text
message_id: 5c11da5f-6796-4deb-9f2a-a2903bc6308b
project_id: 176a4b5d-f369-4d0d-8071-dca41fe352a9
role: assistant
sequence: 3
status: failed
finish_reason: stop
error_code: GENERATION_FAILED
error_message: 生成过程中发生错误
part_count: 72
text_parts: 10
text_chars: 9706
```

其中 `finish_reason=stop` 与 `status=failed` 同时存在，且 `parts[]` 已包含 9706 字正文，说明模型最终回复已经完成，但终态判定被错误降级。

## 影响

- 用户看到完整回答后仍被提示生成失败，误导用户点击 Retry。
- Retry 会创建新的 assistant Message，可能造成重复生成、时间浪费和历史分支噪音。
- 已经写入 DB 的坏终态不会因为前端刷新而恢复，因为 UI 只是在忠实渲染 `MessageDTO.status=failed`。

本次事故不涉及计费逻辑；当前 change 已按既定要求忽略旧计费路径。

## 直接证据

这条消息的 `parts[]` 中存在一个中间工具错误：

```text
idx: 30
type: tool-readUrl
state: output-error
errorText: 生成过程中发生错误
input.url: https://juejin.cn/post/7677432175923888168
```

但同一 URL 后续又读取成功：

```text
idx: 37
type: tool-readUrl
state: output-available
input.url: https://juejin.cn/post/7677432175923888168
```

最终也存入完整正文：

```text
idx: 71
type: text
preview: 研究已完成。以下是基于多轮检索与原文深读的调研报告。
```

因此这不是 sequence 错乱，也不是前端把 completed 渲染成 error；根因位于后端 stream 终态判定。

## 根因

实现把 AI SDK v7 `toUIMessageStream({ onError })` 的回调当成了“整条生成失败”的协议错误信号。

但在 AI SDK v7 中，`onError` 同时承担“把错误转换成用户可见文案”的职责。一个工具调用失败时，SDK 会调用 `onError(error)` 得到 `errorText`，并把该工具 part 更新为：

```text
tool-* state=output-error
```

这类工具错误可以是可恢复的。例如本次事故中，第一次读取掘金文章失败，模型后续重新读取同一 URL 成功，并最终完成报告。

旧逻辑的问题是：

1. `toUIMessageStream.onError` 调用了 `onProtocolError(error)`。
2. `run-generation` 将 `protocolError !== null` 作为整条 generation failed 的一票否决条件。
3. 最终 `finish_reason=stop` 和完整 `parts[]` 仍被写入，但 `status` 被写成 `failed`。

另外，`checkpoint.flush(snapshot)` 失败也曾被写入 `thrown`，理论上会造成另一个同类误判：中途 checkpoint 失败但最终 finalize 可成功时，完整回复也可能被降级为 failed。

## 修复

本次修复保持 UI、DB schema、AI SDK v7 `parts[]` 协议和工具错误展示不变，只调整终态判定边界。

修改点：

- `toUIMessageStream.onError` 只返回用户可见错误文案，不再写入 `protocolError`。
- `consumeUIMessagePipeline` 采集 AI SDK v7 `onEnd.event.outcome`，把 SDK 的 operation-level outcome 传给终态判定。
- UI chunk `type="error"` 不再喂给本地持久 reducer，避免把可恢复 UI 错误误记为 reducer protocol error。
- `resolveGenerationTerminalOutcome` 改为：
  - 应用主动 abort / SDK aborted 优先收敛为 `stopped`。
  - `thrown` 或 SDK outcome failed 收敛为 `failed`。
  - `finishReason === "error"` 收敛为 `failed`。
  - SDK outcome completed 时，可恢复 protocol/UI 错误不得把完整回复降级为 failed。
- `checkpoint.flush(snapshot)` 失败只记录 warning，不再把最终完整生成降级为 failed；最终 `finalizeGeneration` 才是权威终态写入。

## 新增验证

已补充自动化覆盖：

- `tool-error -> 同一工具后续成功 -> text -> finish(stop)`：
  - 期望：终态为 completed。
  - 期望：失败工具 part 仍保留为 `tool-readUrl state=output-error`。
  - 期望：最终正文仍存在。
- `type="error"` UI chunk：
  - 期望：不再被 `onProtocolError` 误记为 reducer protocol error。
- SDK outcome completed + 可恢复 protocol error：
  - 期望：不降级为 failed。
- 应用主动 Stop：
  - 期望：仍优先于 SDK/provider 的错误形态，终态为 stopped。

本次修复后已通过：

```text
pnpm test:thread-chat:gate2-pipeline
pnpm test:thread-chat:gate2-session
pnpm typecheck
```

## 覆盖范围判断

本次修复不是只针对 `5c11da5f-6796-4deb-9f2a-a2903bc6308b` 这条消息，也不是按 URL、掘金、readUrl 或某个具体 tool 打补丁。

它修复的是一类通用问题：

> 可恢复的工具错误或 UI stream 错误已经被保存为 `parts[]` 的局部状态，但最终 SDK outcome/finish 表明整条生成已完成时，不得把 assistant Message 终态写成 failed。

同类场景包括：

- webSearch/readUrl 中某次调用失败，但模型后续换源、重试或继续完成。
- Artifact 工具中间出现可展示的局部错误，但最终消息正常完成。
- UI Message stream 中出现用于展示的 error chunk，但 SDK 最终 outcome 是 completed。
- checkpoint 中途失败但最终 finalize 成功。

## 剩余风险与非覆盖范围

这次修复不是“所有生成失败都不再出现”的兜底，也不应该这么做。以下情况仍应保留 failed：

- provider 或模型流真正 fatal，SDK outcome 为 failed。
- `finishReason === "error"`。
- `run-generation` 主流程抛出不可恢复异常。
- 最终 `finalizeGeneration` 写库失败。
- 完成时没有任何可展示内容，仍由 `finalizeGeneration` 收敛为 `EMPTY_RESPONSE` failed。
- 进程重启导致活跃 generating 丢失，仍按既定设计收敛为 `PROCESS_RESTARTED` failed。

因此，本次修复属于“修正终态判定的不变量”，覆盖了本事故所属的同类误判；不是把所有错误吞掉，也不是只修了当前样例。

## 历史数据处理

本修复只影响之后的生成终态。已经持久化为 `failed` 的历史 Message 不会自动改回 `completed`。

如需修正单条历史数据，应单独做只针对明确 message id 的数据修复，并在执行前确认：

- `finish_reason='stop'`
- `status='failed'`
- `parts[]` 有最终可展示正文
- 错误只来自可恢复工具 part

本次代码修复未执行历史数据改写。
