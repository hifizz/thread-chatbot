## Context

ThreadChat v1 已规范化：`projects → threads → messages` 分表持久化，写操作走 `commandId` 幂等命令，assistant 生成由服务端 session 驱动。`prepareGeneration` 按 research route 组装 system prompt、工具集与 `leadingChunks`（如 `data-research-route`），这些 `data-*` part 会随消息 `parts` jsonb 持久化并经 SSE 实时下发——它就是"本轮生成元数据"的现有载体。

GitHub 侧已有 `lib/agent-demo/github.ts`：`GITHUB_TOKEN`（个人 PAT，服务端环境变量）+ `listUserRepos`/`listBranches`/`getDefaultBranch`，`/api/agent-repos*` 暴露给 agent-demo 页面，但**当前无任何鉴权**。`admin_members` 表是现有的"本人账号"门槛。

本设计只加只读代码上下文，不引入新的连接/任务/沙箱抽象。

## Goals / Non-Goals

**Goals:**

- Thread 级仓库绑定：持久化、Fork 继承、切换/移除只影响后续消息。
- 模型能按"看目录 → 找路径 → 读文件 → 继续读关联文件"的节奏真实读码，并给出可核对的固定 commit 链接。
- 同一轮生成内所有仓库读取固定同一个 `commitSha`；使用记录随消息持久化。
- PAT 场景下的最小访问控制与清晰的失败降级。

**Non-Goals:**

- 不做代码修改、任务派发、提交、PR。
- 不做文件内容全文搜索、向量库或索引（`findRepositoryPaths` 只按路径匹配）。
- 不建 GitHub OAuth/App 多连接体系；`connectionId` 预留字段但当前只有固定 `"github"` 一个服务端连接。
- 不重构 agent-demo 页面；不接入 Pi/E2B。

## Decisions

### D1：绑定存在 `threads.repo_binding`（jsonb，nullable）

```ts
type ThreadRepositoryBinding = {
  connectionId: "github";        // 当前唯一服务端连接；不是 token
  repositoryFullName: string;    // owner/name
  branch: string;
};
```

- 挂在 `threads` 而不是 `projects`：绑定是"这条 Thread 的上下文"，Fork 子 Thread 在 `forkThread` 插入时复制父行绑定即可天然满足"继承后独立修改"。
- 写入走现有 `updateThread` 命令（该命令已承载 `modelId`/`customTitle` 这类 Thread 级设置），schema 增加 `repoBinding` 可空字段，幂等/归档/owner 校验全部复用。
- 绑定时服务端用 `GET /repos/{repo}` 验证 PAT 可见性，避免绑定一个读不到的仓库。

### D2：每轮生成解析一次 commit，闭包固定，不开放给模型参数

`runGenerationCore` 已 owner-scoped 加载 `thread` 行。`prepareGeneration` 输入增加 `repoBinding`；绑定时：

1. `resolveBranchCommit(repo, branch)` → `commitSha`（一次 API 调用）；
2. 构造 `RepositoryReadContext = binding & { commitSha, token }`，token 只存在于服务端闭包；
3. 三个工具的 `execute` 只接收 `path/query/lines`，仓库与 commit 从闭包取——模型无法越界；
4. `buildGenerationTools` 合并 repo 工具；`prepareStep` 的 `activeTools` 放行这三个名字（`availableResearchTools` 对非 webSearch/readUrl 名字本就放行）；
5. 绑定时 `maxSteps` 提升到 `max(mode.maxSteps, REPO_MAX_STEPS)`（常量，建议 8），工具内部再设每轮调用上限。

### D3：`data-repo-context` part 记录本轮 pin，复用现有持久化

`ThreadChatDataParts` 增加：

```ts
"repo-context": {
  repositoryFullName: string;
  branch: string;
  commitSha: string | null;      // 解析失败为 null
  previousCommitSha: string | null;
  bindingChanged: boolean;       // 相对上一条 assistant 消息的绑定是否变了
  status: "ready" | "unavailable";
  error?: string;                // 解析失败的可读原因
}
```

- 作为 `leadingChunks` 注入（与 `data-research-route` 同机制），持久化在消息 `parts` 里，满足"本轮仓库+commit 保存到生成记录"且不新增表。
- `previousCommitSha`/`bindingChanged` 由服务端在生成前扫本 Thread 上一条 assistant 消息的 `data-repo-context` 得到：
  - sha 不同 → UI chip 显示"分支已更新 `abc123 → def456`"；
  - `bindingChanged` → 系统提示明确"绑定已切换，此前轮次的读取结果属于旧仓库/分支，不得当作当前代码事实"。
- 解析失败（分支删了/授权失效/限流）：`status: "unavailable"`，不挂 repo 工具，系统提示声明"仓库当前不可读，不得声称已查看代码"，其余聊天能力照常。

### D4：读取服务 `lib/github/repo-reader.ts`，单次生成内缓存 tree

```ts
listRepositoryFiles({ path })          // GET /repos/{r}/contents/{path}?ref={sha}
readRepositoryFile({ path, startLine, endLine })  // 同上取文件，decode 后切行
findRepositoryPaths({ query })         // GET /repos/{r}/git/trees/{sha}?recursive=1（每轮缓存一次）按 path 子串匹配
```

- 统一 `GitHubApiError`：区分 `not_found / forbidden / rate_limited / too_large / binary / skipped`，工具把失败作为**结构化结果** `{ ok:false, code, message }` 返回给模型而不是抛异常——模型能如实说"读不到"。
- 限额（`constants/repo-chat.ts`）：文件 ≤ `MAX_FILE_BYTES`（256KB）否则截断；单次返回 ≤ `MAX_EXCERPT_LINES`（400 行）/`MAX_EXCERPT_CHARS`；目录 ≤ 200 项；find 结果 ≤ 100 条；每轮 repo 工具调用 ≤ 12 次；tree 条目超过上限时声明 `truncated`。
- 跳过：二进制扩展/含 NUL、常见敏感文件（`.env*`、`*.pem`、`*.key`、`id_rsa*`、`secrets*`、`credentials*`）、大型生成物（lock 文件、`*.min.js`、`*.map`、`node_modules/`、`dist/`）。
- 只对 5xx/限流做有限重试（一次），4xx 权限类不重试。

### D5：UI 复用现有模式，新增两个小组件

- `RepoBindingPicker`（composer 内、附件托盘同级的顶部条）：
  - 未绑定：`绑定 GitHub 仓库` 按钮 → 桌面 `Popover` / 移动 `Drawer`（`useIsMobile` + `components/ui/drawer`），内嵌仓库搜索（`/api/agent-repos`）+ 分支下拉（`/api/agent-repos/branches`）；
  - 已绑定：`📁 owner/name · branch` + `切换`/`移除`，均走 `updateThread` 命令，乐观 upsert `threadsById`。
- `assistantPartRenderPlan` 增加 `"repo-context"` kind（渲染为 chip）与 `"repo-tool"` kind（三个 `tool-*` part 渲染为紧凑过程卡：动作、path/query、状态、行区间/truncated、GitHub 链接）；不再走通用 `工具：state` 占位。
- 仓库不可用时 chip 显示降级原因。

### D6：PAT 门槛 = `admin_members`

- 新增 `lib/github/access.ts`：`assertRepoAccess(userId)` 查 `admin_members`。
- `/api/agent-repos`、`/api/agent-repos/branches` 加 `getCurrentUserId` + admin 校验（当前完全开放，属本变更必须补的洞）；绑定写命令在 application 层同样校验。
- token 只在服务端环境变量；工具结果、data part、日志只含 repo/branch/sha/path，不含 token。
- 仓库内容经系统提示声明为"分析材料"，不改变指令优先级、不扩大工具集。
- 当前无匿名分享功能；spec 记录约束：若未来引入分享，repo 工具结果与 `data-repo-context` 必须参与分享审查。

## Risks / Trade-offs

- **PAT 单连接**：只服务 admin（本人）是刻意的 Demo 边界；将来接 GitHub App 时 `connectionId` 与读取服务的接口不变，只换 token 解析。
- **recursive tree 可能截断**：超大仓库 `findRepositoryPaths` 声明 `truncated`，模型可退回逐层 `listRepositoryFiles`；不为此建索引。
- **历史 tool 结果仍在模型上下文**：绑定切换靠 `bindingChanged` 系统提示纠正，不删历史（成本/审计角度都更稳）。
- **无鉴权的 `/api/agent-repos*`**：加 admin 门槛后 agent-demo 页面在本人账号下照常工作；本地未登录开发时这些端点会 401——与 thread-chat 主链路一致，可接受。
