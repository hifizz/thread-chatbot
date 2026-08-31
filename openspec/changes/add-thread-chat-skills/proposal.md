## Why

Thread Chat 已经具备规范化 Project/Thread/Message、冻结 Fork 上下文、后台 Generation、工具调用、观测和评测基础设施，但产品运行时还没有一套面向终端用户的 Skill 机制。仓库现有 `.agents/skills`、`.claude/skills` 与 `.codex/skills` 服务于开发代理，不能直接等同于 Thread Chat 用户可选择、可持久化、可追踪的运行时 Skill。

本变更要先完成一条最小但完整的纵向链路：用户在输入框输入 `/` 发现并选择 Skill，Thread Chat 把 Skill 作为结构化运行状态而不是普通文本提交，服务端固定不可变 SkillVersion，Generation 使用该版本的指令与受控工具，刷新、Fork、Retry、Edit 后语义仍然一致，并通过稳定 Prompt 前缀提高供应商 Prompt Cache 的可复用率。

第一个内置 Skill 是 `research`。它具有跨轮检查点，因此必须支持 sticky 激活；同时 MVP 保留 one-shot 模式，供后续简单 Skill 使用。

## What Changes

- 新增独立的运行时 Skill Catalog，兼容以 `SKILL.md` 为入口、带 YAML frontmatter 与只读 Markdown references 的 Skill 包；它与开发代理使用的 `.agents/.claude/.codex` Skill 目录严格隔离。
- 新增 `skills` 与不可变 `skill_versions` 数据，并记录安全的来源标识/发布 revision；内置 Skill 通过部署同步导入，管理员通过本地目录 CLI 安装；MVP 不提供用户上传、远程 GitHub URL 安装或公共 Marketplace。
- 在 Thread 上保存当前 sticky SkillVersion，在每条 assistant Message 上固定本次 Generation 实际使用的 SkillVersion；已开始的 Generation 不受后续 Thread Skill 切换或 Skill 新版本发布影响。
- 在列视图和画布共用的 Composer 中加入 Slash 菜单、键盘导航、Skill Chip、清除与切换；Slash token 不进入用户 Message 正文。
- 一次只允许选择一个 Skill。sticky Skill 跨轮和刷新持续；one-shot Skill 只作用于下一次新 Generation，成功接受后自动清除。
- 扩展 Start/Send/Thread Update 命令，使 Skill 选择与 Message/assistant placeholder 在服务端事务中固定；客户端提交的只是 `skillVersionId`，不能提交 Skill 正文、工具或 System Prompt。
- ForkedThread 在创建事务中复制父 Thread 当时的 sticky SkillVersion，之后父子独立；Retry/Regenerate 与 Edit-and-Regenerate 默认复制被替代 assistant Message 的 SkillVersion，而不是读取当前 Thread 的 Skill。
- 引入 Skill-aware Prompt Compiler：固定平台规则、Capability Profile、SkillVersion 与资源索引形成规范化稳定前缀；工具定义顺序固定；随机 ID、时间戳、Thread/Message/Generation 身份不得进入稳定前缀。
- 将 Fork anchor 从动态 System Prompt 移出，按确定性规则附着到 ForkedThread 的首条用户模型消息，使兄弟分支可以复用平台、Skill 与冻结历史前缀。
- `research` 激活时绕过现有自动 research route/plan 分类器，不强制首步工具调用；由 Research Skill 的检查点规则决定何时澄清、何时计划、何时调用稳定 `research-v1` 工具集合。
- 新增只读 `readSkillResource` 工具，实现 references 的按需加载；Skill 只能请求预定义 Capability Profile，不能授予工具权限。
- 将 Skill ID、版本、digest、激活模式、Capability Profile、稳定前缀 digest 与缓存用量接入现有 Trace/Eval；生产遥测默认不记录完整 Skill 正文或 reference 内容。
- 增加 Skill 语义、Composer、Fork/Retry/Edit、Prompt prefix 与 Research 检查点评测。
- MVP 明确不执行 Skill 自带脚本，不创建 Sandbox，不引入持久 `SkillRun` 工作流状态机。

## Capabilities

### New Capabilities

- `thread-chat-skills`: 定义运行时 Skill Catalog、Slash 选择、sticky/one-shot 激活、不可变版本固定、Thread/Fork/Message 生命周期、Prompt 编译、Capability Profile、references 读取、安全边界、缓存与评测契约。

### Modified Capabilities

- `domain`: 增加 Skill、SkillVersion 与 ActiveSkill 的统一领域术语，并明确 ActiveSkill 与一次 Generation 固定版本的区别。

## Impact

- **数据库**：新增 `skills`、`skill_versions`；`threads` 增加 nullable active SkillVersion；`messages` 增加 nullable pinned SkillVersion。迁移是加法式，旧数据保持 `null`。
- **运行时**：Generation 从 assistant Message 读取固定 SkillVersion；Skill 激活路径采用稳定 Capability Profile，并与现有 no-skill research router 分流。
- **Prompt/缓存**：重构 `buildThreadChatSystem` 与 `compileModelContext` 的边界；Fork anchor 不再作为每次请求的动态 System 片段。增加稳定前缀 digest 与供应商缓存适配层。
- **API/客户端**：扩展 Start、Send、UpdateThread、ThreadDTO、MessageDTO 和 Project bootstrap；增加 Skill Catalog 查询。
- **前端**：改造共用 `ConversationComposer` 的 draft 状态与键盘处理，列/画布共享 Slash 菜单和 Skill Chip。
- **部署**：数据库迁移后必须执行内置 Skill 同步；Research Skill 的 package digest 成为发布与评测指纹。
- **安全**：客户端永远不能上传或覆盖 Skill 指令；管理员安装只接受受限文本包；禁用或撤销的 Skill 在付费模型调用前失败。
- **未来兼容**：复杂脚本 Skill、Sandbox、Secret Broker、Approval 与持久 SkillRun 不在本 change 中，但 Message 的 SkillVersion pinning 可继续复用。
