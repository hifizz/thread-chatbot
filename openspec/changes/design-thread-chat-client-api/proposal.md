## Why

`define-thread-chat-domain-model` 已经确立服务端目标模型 `Project → Thread → Message`，但当前前端仍围绕整棵 `ThreadTreeState`、全局 version 和承担多重职责的 `chat-controller` 工作。若不先固定客户端的实体边界、状态职责、Store Action/Application Command 语义和服务端能力，后续 API、Store、Hooks 与 UI 会再次各自发明关系和状态。

本 change 以已确认的领域模型为前提，定义前端如何保存服务端事实、如何从 Store 派生 UI ViewModel、用户操作如何通过 Application Command 变成服务端命令，以及后端 `/api/v1` 必须提供哪些 Query、Command 与生成恢复能力。

## What Changes

- 定义规范化的前端实体模型：Project、Thread、Message、Artifact，以及以 `assistantMessageId` 为关联键的 AssistantRunState。
- 定义轻量全局 ProjectCatalogStore 与按 `projectId` 创建的 ThreadChatStore；同一个 Project Store 以高内聚 slices 管理服务端实体、加载状态、生成流状态和本地工作台状态。
- 明确服务端确认实体、运行态、本地 UI 态和派生 ViewModel 的边界；禁止恢复整棵 `ThreadTreeState` 或把派生树形数据复制为第二份权威状态。
- 统一 Store State、Store Action、Application Command、Selector Hook、Command Hook 和 Lifecycle Hook 术语。
- 定义纯 Selector 与三类 Hook 的职责，避免 UI 组件直接 `fetch`、拼 Prompt 或修改实体。
- 定义前端 Application Commands：Project 生命周期、Thread 加载与 Fork、消息发送/Edit/Regenerate、生成订阅/Stop、feedback 和 Project 元数据更新。
- 定义 `/thread-chat/new` 为无实体 ID 的本地草稿入口；第一次发送时服务端原子创建 Project、Root Thread、首条 user Message、assistant Message 与 MessageRun，客户端再根据返回的 `project.id` 通过集中式路由构造器替换为已创建 Project 的页面 URL。
- 定义后端 `/api/v1` 的资源标识、请求参数、响应 DTO、错误、原子性、权限与适用场景；所有新实体 ID 均由服务端生成。
- MVP 首次加载返回全量轻量 Thread topology 和 Root Thread 数据；其他 Thread 按需一次加载最多 200 条有效 Message，不实现复杂分页替换。
- 本 change 只形成设计与可测试契约，不实现 Zustand Store、Hooks、Route Handler、Stream Client 或 Transport 封装，也暂不编写实施 tasks。

## Capabilities

### New Capabilities

- `thread-chat-client-state`：前端规范化实体、Project-scoped Zustand Store、Store Actions、Application Commands、selectors、Hooks、工作台状态与 `/new` 生命周期。
- `thread-chat-command-api`：支撑 Project、Thread、Message、Fork 和 MessageRun 的 `/api/v1` Query/Command/恢复契约。

### Modified Capabilities

- 无。

## Impact

- 前端目标：替换当前整树 Store、全局 version 订阅、客户端实体 ID 和 `chat-controller` 混合职责；保留组合根、纯 selector、流式合帧与设备本地工作台偏好等正确方向。
- 后端目标：为新领域模型提供 ProjectBootstrap、Thread Message Query、原子业务 Command 和以 `assistantMessageId + eventSequence` 为核心的生成恢复接口。
- 共享契约：请求/响应 DTO 必须由前后端共用 schema 校验；具体 HTTP client、认证包装和 SSE 解析属于后续 Transport 设计。
- 路由：新增 `/thread-chat/new` 草稿入口；已持久化内容使用 `/thread-chat/{projectId}`。
- OpenSpec：依赖 `define-thread-chat-domain-model` 中 Project、Thread、Message、MessageRun、BaseContext 和 replacement 不变量，不重新定义后端持久化 Schema。
