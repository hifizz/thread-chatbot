# LangMem：hot path 工具、后台 manager 与程序性记忆

> 源码快照：`langchain-ai/langmem@a2d580946465137c89162e67dc0b18108bd4850c`（2026-07-15）。重点文件：[`knowledge/tools.py`](https://github.com/langchain-ai/langmem/blob/a2d580946465137c89162e67dc0b18108bd4850c/src/langmem/knowledge/tools.py)、[`knowledge/extraction.py`](https://github.com/langchain-ai/langmem/blob/a2d580946465137c89162e67dc0b18108bd4850c/src/langmem/knowledge/extraction.py)、[`prompts/optimization.py`](https://github.com/langchain-ai/langmem/blob/a2d580946465137c89162e67dc0b18108bd4850c/src/langmem/prompts/optimization.py)。

## 三组能力

LangMem 不是单一“记忆数据库”，而是构建在 LangGraph store 之上的三组 primitive：

1. hot path 的 `manage_memory` / `search_memory` 工具；
2. background 的 `MemoryManager` 抽取与整合；
3. 根据轨迹和反馈更新系统提示的 prompt optimizer。

## Hot path 工具

`create_manage_memory_tool()` 生成一个结构化工具：

```text
content: str | 自定义 Pydantic schema
action: create | update | delete
id: UUID（update/delete 必填）
```

实现本身很薄：

- namespace 通过模板和 runtime config 解析，可做 per-user 分区；
- delete 调 `store.delete/adelete`；
- create 生成 UUID；
- create/update 都调用 `store.put/aput`，value 为 `{"content": ...}`；
- 默认说明要求模型主动保存偏好、显式记忆请求、工作上下文，并修正过期 memory。

因此“一致性”主要依赖模型是否调用正确 action；BaseStore 只提供存取，不自动理解冲突。

## Background MemoryManager

`MemoryManager` 使用 Trustcall 的 schema extraction：

- 输入：新消息、可选 existing memories、`max_steps`；
- 默认支持 insert/update，delete 默认关闭；
- `_prepare_messages()` 把轨迹和“extract/contextualize、compare/update、synthesize”说明组成 memory subroutine；
- `create_extractor()` 接收自定义 schemas 和已有文档 ID；
- 每步可并行产生多个 tool calls；第二步起增加 `Done` 工具；
- 外部传入的 memory ID 被保留，update 继续使用同一 ID；
- 返回的是变更后的 memory objects，`create_memory_store_manager()` 再负责持久化。

这比“让聊天主模型自己顺便记住”更易测试，因为 memory manager 是独立纯函数式边界。

## 程序性记忆

`create_prompt_optimizer()` 支持：

- `prompt_memory`：单次调用提取成功模式；
- `metaprompt`：多轮分析/更新；
- `gradient`：反思与应用更新分开，调用最多。

它实际上会改写 agent 的行为 prompt。此能力风险高于事实记忆：错误或恶意反馈可能长期改变系统行为，必须版本化、评测并审批，不能直接让终端用户对生产 system prompt 写入。

## 优点

- 工具、抽取 manager、存储分层清楚；
- schema 可由应用定义；
- namespace 明确，PostgresStore 可用于生产；
- background manager 可以独立回放与评测；
- delete 默认关闭是合理保守值。

## 与本项目的摩擦

- Python + LangGraph/Trustcall 生态，与当前 TypeScript + AI SDK v7 不同；
- 引入它仍需部署 Python 服务或重写桥接；
- current project 已有 AI SDK `tool()`、Zod schema、Drizzle 和 `prepareStep`，核心 primitive 可原生实现；
- prompt optimizer 不应成为第一版用户记忆的一部分。

## 可移植设计

在本项目中可以复刻，而无需引入依赖：

```text
Zod CandidateFact[]
  <- 独立 generateText/object 输出
  <- new events + selected current facts

deterministic reducer
  -> insert/supersede/ignore

Drizzle transaction
  -> event + facts + extraction run
```

模型只提议候选，reducer 决定允许的状态迁移；这比 hot-path 工具直接 CRUD 更符合当前需求。

## 判定

**借鉴 background manager，不接入 LangMem。** 程序性记忆等事实记忆和评测体系稳定后再单独立项。
