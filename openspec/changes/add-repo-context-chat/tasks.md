## 1. 契约与数据层

- [ ] 1.1 `constants/repo-chat.ts`：限额常量（文件大小/行数/字符数、目录项数、find 结果数、每轮工具调用数、`REPO_MAX_STEPS`）、敏感/二进制/生成文件规则、`ThreadRepositoryBinding` 与 `RepositoryReadContext`、`RepositoryFileExcerpt` 类型、系统提示模板与用户文案
- [ ] 1.2 `lib/db/schema.ts`：`threads` 增加 nullable `repo_binding` jsonb 列；本 worktree 数据库 `pnpm db:push`（不生成 migration）
- [ ] 1.3 `contracts/dto.ts` + `mappers.ts`：`ThreadDTO.repoBinding`；`contracts/commands.ts` 的 `updateThreadCommandSchema` 增加 `repoBinding`（nullable optional）并放宽"至少一个字段"校验
- [ ] 1.4 `contracts/ui-message.ts`：`ThreadChatDataParts` 增加 `repo-context`；`ThreadChatTools` 增加三个仓库工具的 input/output 类型

## 2. GitHub 读取服务与访问控制

- [ ] 2.1 `lib/github/repo-reader.ts`：`GitHubApiError` 分类、`resolveBranchCommit`、`listDirectory`、`readFileExcerpt`（切行+truncated）、`findPaths`（recursive tree，每轮缓存）、敏感/二进制/生成文件跳过、有限重试
- [ ] 2.2 `lib/github/access.ts`：`assertRepoAccess(userId)` 查 `admin_members`；`/api/agent-repos` 与 `/api/agent-repos/branches` 两个 route 增加登录 + admin 校验
- [ ] 2.3 绑定时 `GET /repos/{repo}` 验证 PAT 可见性，不可达则拒绝命令

## 3. 生成链路接入

- [ ] 3.1 `lib/thread-chat/streaming/repo-tools.ts`：`createRepoReadTools(context)` 返回三个 `tool()`，execute 输出结构化结果（含 path/commitSha/行区间/truncated/错误码），共享每轮调用计数
- [ ] 3.2 `generation-tools.ts`：`buildGenerationTools` 支持合并 repo 工具；`generation-plan.ts` 在绑定存在时解析 commit、构造上下文、挂载工具、追加仓库系统提示段、`maxSteps` 提升、构造 `data-repo-context` leading chunk（含 previousCommitSha/bindingChanged/status）
- [ ] 3.3 `run-generation.ts`：把 `thread.repoBinding` 与上一条 assistant 消息的 repo-context 传入 `prepareGeneration`；解析失败走 unavailable 分支（不挂工具、提示降级）
- [ ] 3.4 `fork-thread.ts`：插入子 Thread 时复制 `parent.repoBinding`；`project-mutations.ts` 的 `updateThread` 处理 `repoBinding`（admin 校验 + 仓库可达校验）

## 4. 客户端

- [ ] 4.1 `net/client.ts`/`conversation-commands.ts`：`updateThread` 透传 `repoBinding`；`startProject`/`forkThread` 乐观构造的 `ThreadDTO` 补 `repoBinding`
- [ ] 4.2 `chat/composer/repo-binding-picker.tsx`：未绑定按钮 + 仓库搜索 + 分支选择；已绑定 chip + 切换/移除；桌面 `Popover`、移动 `Drawer`（`useIsMobile`）；接入 `ConversationComposer`
- [ ] 4.3 `assistantPartRenderPlan` + `anchored-assistant-body`：`repo-context` chip（绑定@短 sha/分支更新/不可读原因）与 `repo-tool` 过程卡（动作、path/query、状态、行区间、truncated、GitHub 链接），不再落通用 tool 占位

## 5. 验证

- [ ] 5.1 `pnpm typecheck` + `pnpm lint` 通过
- [ ] 5.2 真实验收（私有测试仓库）：选择绑定 → 刷新保留 → 提问需读码的问题 → 可见目录/文件读取过程 → 回答链接可核对 commit 与行号 → 同轮同 commit → 切换/移除行为正确 → 未绑定聊天不受影响 → 授权不足/文件不存在显示可读错误 → 移动端选择器可用
- [ ] 5.3 `pnpm openspec:validate` 通过；本地提交（不推送、不部署）
