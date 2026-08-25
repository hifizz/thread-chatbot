# 从首页进入 ThreadChat

## 决定性结论

登录 Session 已经确定 actor。首页只决定导航目标，不提前创建空 Project，也不把当前 Project ID 写入 App Store：

```text
“新对话”
  → /thread-chat/new
  → 用户首次发送前没有 Project、Thread、Message 或 MessageRun

“继续最近对话”
  → 有最近可访问 Project：/thread-chat/{projectId}
  → 没有 Project：/thread-chat/new

“对话列表”
  → 分页列出当前用户可访问的 ProjectSummary
```

Project Catalog 不是进入 Project 页面之前必须完成的前置请求。用户直接打开 `/thread-chat/{projectId}` 时，URL 是当前 Project 的唯一权威；ProjectProvider 可以独立加载 ProjectBootstrap。

## 首页导航伪代码

```ts
async function onStartChatClick() {
  const latest = selectLatestLoadedProjectSummary(appStore.getState())

  if (latest) {
    router.push(threadChatRoutes.project(latest.id))
    return
  }

  // Catalog 尚未加载完成时可以查询最近 ProjectSummary；该查询不创建实体。
  const result = await threadChatApi.listProjects({
    status: "active",
    limit: 1,
  })

  const project = result.items[0]
  router.push(
    project
      ? threadChatRoutes.project(project.id)
      : threadChatRoutes.newProject(),
  )
}

function onNewProjectClick() {
  // 这里只导航，不请求服务端创建空 Project。
  router.push(threadChatRoutes.newProject())
}
```

## `/thread-chat/new` 的领域边界

```ts
type NewProjectDraftState = {
  parts: UIMessage["parts"]
  requestedModelId?: string
  submitState: "idle" | "submitting" | "error"
}
```

`NewProjectDraftState` 是本地草稿，不是 Chat Entity。只有用户提交第一条有效 Message 后，服务端才在同一事务创建：

```text
Project
└── Root Thread
    ├── U1 finalized
    └── A1 pending ── MessageRun queued
```

请求不得携带任何待创建实体 ID。服务端返回 `CreationBundle` 后，客户端才能建立 ProjectRuntime，并使用 `threadChatRoutes.project(bundle.project.id)` 构造目标页面路径后执行 `router.replace`。服务端不返回 Web 页面 URL。

完整的无抖动 Provider/Store 交接、AI 事件订阅和终态合并见：

- [新 Project 首条消息与 AI 回复生命周期](../../design-thread-chat-client-api/design/new-project-first-message-lifecycle.md)

## 已有 Project 的 Bootstrap 边界

进入 `/thread-chat/{projectId}` 时，服务端返回：

```text
Project
+ 全量轻量 Thread topology
+ ProjectArtifactSummary
+ Root ThreadMessageBundle
```

不返回所有 Branch Message、BaseContext、Prompt History 或全部大型 Artifact 正文。刷新前恢复出的 Branch Column 由客户端分别异步加载 MessageBundle。

完整的有/无工作台 Snapshot、Runtime Message Cache 和多个 Branch 并行加载流程见：

- [打开已有 Project 生命周期](../../design-thread-chat-client-api/design/open-existing-project-lifecycle.md)

## 决定性不变量

- `/thread-chat/new` 中的 `new` 不是 Project ID。
- 用户首次发送前不得创建 Project 或 Root Thread。
- 当前 Project 身份只来自 URL/ProjectProvider，不来自 App Store 的 selected 状态。
- Project Catalog 只保存分页摘要，不保存 Thread 或 Message。
- ProjectBootstrap 不创建领域实体，只读取服务端事实。
- Root Message 随 Bootstrap 加载；Branch Message 按 Thread 异步加载。
