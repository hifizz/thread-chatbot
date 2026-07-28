# Letta / MemGPT：常驻 memory blocks 与后台 agent

> 生态快照：2026-07-24。`letta-ai/letta` 主仓库已明确标注为 legacy V1 server；新项目推荐 Letta Agent SDK。用于通用记忆的实验性封装快照为 `letta-ai/ai-memory-sdk@4494e00410469082bf298b8b03b7c9f93e244f14`。

## 设计动机

MemGPT/Letta 的核心比喻是“LLM 操作系统”：上下文窗口像有限内存，agent 通过工具主动编辑常驻内容，并把更大历史放入可检索的外部存储。

当前可见的层次：

- **memory blocks**：常驻上下文的带 label 文本块，如 `human`、`persona`、`preferences`；
- **files**：较大的只读/可开关资料；
- **archival memory**：可写、语义检索的长尾 passages；
- **external RAG**：通过自定义工具/MCP 访问。

Letta 文档对旧 V1 的建议是：重要且小的内容放 blocks，较弱的情景记忆放 archival。

## AI Memory SDK 的实现模型

实验性 Memory SDK 没有把主聊天模型换成 Letta，而是创建一个“subconscious agent”：

```text
subject_id
  -> 一个 Letta memory agent
  -> 多个 labeled blocks

主应用先读取 blocks -> 拼进自己的 system prompt
主应用完成对话 -> 批量 add_messages()
memory agent 异步处理 -> 更新 blocks
可选 skip_vector_storage=false -> 写 archival passages
```

一个 subject 可以是用户、项目或团队。SDK 建议每次批量发送 5–10 条消息或只在消息被挤出上下文时处理，以降低 agent 调用成本。

## 与早期 MemGPT 的变化

不能再按 2023 年论文假设当前产品 API：

- V1 server/SDK 仍存在，但官方主仓库已称 legacy；
- 新入口是 Agent SDK、Letta Code/App Server；
- memory filesystem、git-backed context、sleeptime/dreaming 等能力仍在快速演进；
- 因此源码级集成必须钉版本，不能只依据论文概念。

## 优点

- memory block 是“每轮必带压缩视图”的直接实现；
- block label/description 给模型明确写入边界；
- blocks 可跨 agent 共享；
- 主 agent 与后台 memory agent 分离，避免阻塞用户响应；
- archival 层补足 block 容量限制。

## 风险

- 记忆 agent 本身是有状态 runtime，接入不只是加一个数据库 SDK；
- block 自编辑仍由 LLM 决定，缺少强 schema 当前值约束；
- 一用户一 agent 带来生命周期、成本、删除和并发管理；
- 官方推荐入口变化快，V1、Agent SDK、Memory SDK、Code SDK 容易混用；
- 当前项目已有自己的 tree state、streaming、tools 与计费，替换运行时侵入面很大。

## 可复用点

- 用多个短 block，而不是一个无限增长的“用户简介”；
- label + description 同时约束写入和注入语义；
- 画像常驻、长尾事件检索；
- 后台 worker/agent 处理 memory，不占主聊天延迟；
- 对记忆变更做版本化，借鉴 git-backed context 的可回滚思想。

## 判定

**不接入。** 其 memory blocks 是有价值的产品抽象，但本项目可以用 `memory_profiles.profile_json` 与固定 sections 更轻量地实现。
