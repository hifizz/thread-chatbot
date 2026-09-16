## Why

ThreadChat 目前只能基于对话历史和用户上传的 Attachment 回答问题。用户希望在提问前把一个 GitHub 仓库绑定到当前 Thread，让模型实际查看目录结构、按需读取真实代码，再给出带文件/行号/commit 出处的回答。现有 Agent Task Demo 已经跑通了 `GITHUB_TOKEN` 授权、仓库列表和分支选择，可以直接复用，不需要另建一套接入。

本变更只做**只读代码讨论**：不改代码、不派发任务、不建 PR、不建向量索引。

## What Changes

- Thread 增加可选的仓库绑定（一个 Thread 最多一个 `repositoryFullName + branch`），随 Thread 持久化；Fork 出的子 Thread 继承父 Thread 当时的绑定，之后可独立修改或移除。
- 聊天输入框上方新增仓库上下文选择条：未绑定时提供「绑定仓库」入口（搜索仓库 + 选分支），已绑定时显示 `📁 owner/name · branch` 并提供切换/移除；移动端复用现有 Drawer。
- 为绑定了仓库的生成提供三个只读服务端工具：`listRepositoryFiles`、`readRepositoryFile`、`findRepositoryPaths`（按路径查找，非全文搜索）。仓库、连接与 commit 由服务端固定，模型不能通过参数指定其他仓库。
- 每次生成开始时把绑定分支解析为固定 `commitSha`，本轮所有工具读取使用同一个 commit；实际使用的仓库与 commit 以 `data-repo-context` part 记录在 assistant 消息上（复用现有 `data-*` 持久化机制，不新增概念）。分支版本变化时给出简短提示；绑定切换后在系统提示中明确告知模型旧读取结果失效。
- 工具结果携带 `path / commitSha / startLine / endLine / truncated`，系统提示要求模型用 `https://github.com/{repo}/blob/{sha}/{path}#Lx-Ly` 形式的固定 commit 链接引用出处。
- 安全边界：`/api/agent-repos*` 与绑定写操作限制为 admin 成员（当前唯一连接是服务端个人 PAT）；token 不出服务端；跳过二进制、常见敏感文件与大型生成文件；限制文件大小、单次返回量与每轮工具调用数；读取失败时模型不得声称已检查代码，普通聊天不受影响。

## Capabilities

### New Capabilities

- `repo-context-chat`: Thread 仓库绑定的保存/继承/切换/移除，服务端只读仓库工具，按 commit 固定的读取上下文，生成记录中的出处元数据，以及 PAT 场景下的访问控制与降级行为。

### Modified Capabilities

（无——现有 `openspec/specs/` 中没有覆盖 Thread 仓库上下文的能力。）

## Impact

- 数据库：`threads` 新增 nullable `repo_binding` jsonb 列（worktree 内 `pnpm db:push`，不生成 migration）。
- 契约：`ThreadDTO` 增加 `repoBinding`；`updateThread` command 增加 `repoBinding` 字段；`ThreadChatDataParts` 增加 `repo-context`；`ThreadChatTools` 增加三个仓库工具类型。
- 服务端：`fork-thread.ts`（继承绑定）、`project-mutations.ts`（绑定写）、`generation-plan.ts`/`run-generation.ts`（commit 解析、工具挂载、系统提示、data part）、`generation-tools.ts`、新增 `lib/github/` 读取服务与访问控制、`constants/repo-chat.ts`。
- API：`/api/agent-repos` 与 `/api/agent-repos/branches` 增加登录 + admin 门槛（当前为无鉴权开放）。
- 客户端：`conversation-commands.ts`/`client.ts`（绑定写命令）、composer 上方新增 `RepoBindingPicker`、`assistantPartRenderPlan`/`anchored-assistant-body`（repo-context chip 与仓库工具过程卡）。
- 复用：`lib/agent-demo/github.ts` 的仓库/分支列表 API、现有 `data-*` part 持久化链路、`Drawer`/`Popover`/`useIsMobile`、`admin_members` 门槛。
- 明确不做：代码修改、任务派发、PR、全文内容搜索、向量索引、Pi/E2B 接入、多连接管理。
