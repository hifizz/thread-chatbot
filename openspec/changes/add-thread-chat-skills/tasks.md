## 1. 固定基线、OpenSpec 与 Feature 边界

- [ ] 1.1 以 `48483101ad11bc84b611b615f423577633fedacb` 为实施基线，重新运行 `pnpm typecheck`、`pnpm build`、现有 Thread Chat Gate、Agent eval smoke 与 `pnpm openspec:validate`
- [x] 1.2 创建 `add-thread-chat-skills` OpenSpec change，提交 proposal、design、`thread-chat-skills` capability delta、`domain` 术语 delta 和本任务清单
- [x] 1.3 在常量中定义 Skill activation mode、source type、version status、Capability Profile ID、错误代码、包大小限制、Prompt/cache policy version
- [x] 1.4 明确 `.agents/.claude/.codex` Skill 是开发代理配置，增加文档和代码保护，禁止运行时扫描这些目录
- [x] 1.5 增加 server-only Feature 配置：Catalog discovery/UI 可关闭，但已固定的历史 SkillVersion 数据不得被回滚删除

## 2. Skill 包验证、Catalog 与管理员 CLI

- [x] 2.1 新建 `runtime-skills/research/`，为用户确认的 Research 内容增加规范 frontmatter，并把输出模板、质量清单等拆入 `references/`
- [x] 2.2 实现 Skill package canonicalizer：UTF-8/BOM/LF 规范化、路径排序、frontmatter 解析、资源索引和 SHA-256 digest
- [x] 2.3 实现包安全验证：slug、允许文件类型、symlink/path traversal、重复路径、单文件/总包大小、reference 数量和未知 Capability Profile
- [x] 2.4 明确拒绝 `scripts/`、可执行文件、二进制和依赖描述；测试不能以“忽略但继续安装”绕过
- [ ] 2.5 实现 Skill repository/service，支持按 current catalog、version ID、digest 和 resource path 查询
- [x] 2.6 实现 `pnpm skills:validate -- --path`，只校验并输出规范摘要/digest，不写数据库
- [ ] 2.7 实现 `pnpm skills:sync`，幂等导入所有内置 Skill；相同 digest 复用，变化时创建新版本并原子切 current
- [ ] 2.8 实现 `pnpm skills:install -- --path` 与 `skills:disable -- --slug` 的管理员本地操作；不增加公开安装 API
- [ ] 2.9 增加 importer 合同测试，覆盖合法 Research、重复同步、版本升级、无 version fallback、非法 YAML、路径攻击、超限、脚本、未知 Profile 和事务回滚

## 3. 数据库、DTO 与领域投影

- [ ] 3.1 在 `lib/db/schema.ts` 增加 `skills`、`skill_versions`、安全 source revision 与索引/检查约束；已发布 SkillVersion 内容不得通过普通应用路径更新
- [ ] 3.2 给 `threads` 增加 nullable `active_skill_version_id` FK，给 `messages` 增加 nullable `skill_version_id` FK，并限制 Message 引用只用于 assistant
- [ ] 3.3 生成 Drizzle migration；验证旧 Project/Thread/Message 全部以 `null` 平滑加载，回滚不删除已写数据
- [ ] 3.4 定义 `SkillVersionSummaryDTO`、`SkillCatalogDTO`，扩展 ThreadDTO/MessageDTO/ProjectBootstrapDTO 与类型测试
- [ ] 3.5 扩展 persistence mapper/query，批量解析 Thread ActiveSkill 与 Message Pinned SkillVersion，避免 N+1
- [ ] 3.6 更新规范化客户端 store、optimistic snapshot、projection 与兼容 Tree 投影，使列/画布都能读取 `activeSkill`
- [ ] 3.7 增加数据库 Gate：唯一 current version、不可删除引用版本、assistant-only pin、Catalog disabled/revoked、Thread active pointer

## 4. 命令、API 与幂等语义

- [ ] 4.1 扩展 StartProjectCommand：可选 `skillVersionId`
- [ ] 4.2 扩展 SendMessageCommand：`skillVersionId?: string | null`，实现 omitted/inherit、null/clear、string/select 三态
- [ ] 4.3 扩展 UpdateThreadCommand：`activeSkillVersionId?: string | null`，只允许持久化 sticky 版本
- [ ] 4.4 实现共享 `resolveEffectiveSkillForTurn`，在事务内验证 enabled/revoked/profile，并返回 Thread 更新值与 assistant pin
- [ ] 4.5 将 Start/Send 的 Skill 解析、Thread pointer 更新、user Message 和 assistant placeholder pin 放入同一幂等事务
- [ ] 4.6 扩展 API handler/error mapping，返回稳定 `SKILL_*` 错误，确保新 Turn 的失败发生在 `startSessionAfterCommit` 和正式回答模型调用之前；已接受的后台 Generation 不因普通 disable 竞态改变 Prompt
- [ ] 4.7 增加 `GET /api/thread-chat/v1/skills`，只返回展示元数据/current version，支持 ETag，不返回 instructions/resources
- [ ] 4.8 扩展 Thread Chat client 与 command layer，支持 catalog、sticky update、one-shot pending 和 accepted 后清理
- [ ] 4.9 增加 API/DB 幂等测试：Start、Send、clear、switch、one-shot、replay、并发 update、disabled/revoked/profile unavailable

## 5. Composer Slash 菜单与 Skill Chip

- [ ] 5.1 将 `ConversationComposer` 的 draft/selection/menu 行为抽入共用 hook 或纯逻辑模块，保留现有 auto-grow、prefill、IME 和 Enter/Shift+Enter 语义
- [ ] 5.2 实现 Slash parser：仅第一 token、cursor-aware、精确 token 删除、剩余文本保留、未知 `/text` 不误执行
- [ ] 5.3 实现键盘 listbox：Arrow、Enter、Tab、Esc、IME guard、ARIA active descendant 与点击选择
- [ ] 5.4 实现单 Skill Chip、清除、sticky/one-shot 状态与 busy 禁用；列/画布共享逻辑，仅样式不同
- [ ] 5.5 sticky 选择在已有 Thread 上 optimistic update + 服务端确认；失败回滚并保留 draft
- [ ] 5.6 one-shot 只保留在 Composer pending；accepted 后清除，网络/API 失败保留
- [ ] 5.7 新 Project 的 pending selection 以 Project URL UUID 为 key 保存本地 draft，Catalog 加载后重新校验；Start 成功后转为服务端事实源
- [ ] 5.8 assistant Message 增加 Skill badge，显示 name/version；历史版本即使不再 current 仍可展示
- [ ] 5.9 增加 Composer 测试：中文输入法、粘贴、移动光标、空白、exact/partial query、Escape 层级、busy、两种 viewport、发送正文不含 Slash

## 6. Fork、Retry、Edit 与生命周期一致性

- [ ] 6.1 修改 Fork 事务，使 child `active_skill_version_id` 精确复制 parent 当前 sticky 指针
- [ ] 6.2 带首问 Fork 的 assistant Message pin 使用 child 已复制版本；空 Fork 后续 Send 使用 child 独立当前值
- [ ] 6.3 修改 Retry/Regenerate：只复制 source assistant `skill_version_id`，不读取 Thread 当前 active
- [ ] 6.4 修改 Edit-and-Regenerate：优先复制被替换 assistant SkillVersion；不存在 assistant 时才读取 Thread active
- [ ] 6.5 Retry/Edit 不得修改 Thread active pointer；revoked/disabled 历史版本显式失败，不自动升级
- [ ] 6.6 更新 optimistic client rows，使临时 assistant Message 的 Skill summary 与服务端最终 DTO 一致
- [ ] 6.7 增加生命周期 Gate：父子独立、nested Fork、one-shot 不继承、父切换后 Retry、Edit、command replay、刷新恢复

## 7. Skill-aware Generation、references 与 Prompt Compiler

- [ ] 7.1 在 `runGeneration` 从 assistant Message pin 加载 SkillVersion，而不是从 Thread 当前 pointer 加载
- [ ] 7.2 定义 Capability Profile registry 和稳定 digest；实现 `skill-core-v1`、`research-v1`
- [ ] 7.3 实现稳定 `readSkillResource` Tool，按 pinned version 精确读取、限制长度并输出 path/digest
- [ ] 7.4 拆分 `buildThreadChatSystem`：平台/Agent 稳定规则与动态数据分离；Skill block 明确低于平台/Action Policy
- [ ] 7.5 实现 canonical Skill prompt：instructions LF 规范化、resource index 按路径排序、Tool 名/Schema 顺序固定
- [ ] 7.6 修改 `compileModelContext`，将 Fork anchor 确定性编译到首条 child user 模型消息；不改数据库 user text
- [ ] 7.7 增加旧 Fork 兼容测试：无 persisted quote part 时由 thread anchor 稳定补齐，后续请求结果一致
- [ ] 7.8 Skill-driven Generation 分流：跳过 `resolveResearchRoute/createResearchPlan`，不动态增减 Tool，不强制 first tool
- [ ] 7.9 no-skill Generation 保留当前 answer/fetch/search/research 行为与 leading data parts
- [ ] 7.10 Research path 使用固定 `research-v1` Tool Set 与 step budget；检查点阶段由 Skill 指令控制
- [ ] 7.11 生成 `PromptCachePlan`：stable prefix digest、profile digest、cache policy version、provider strategy/key
- [ ] 7.12 Provider cache key 使用 provider + exact upstream model/cache identity，并排除 Project/Thread/Message/Generation/request/time/anchor/user text；不支持的 route 使用 no-op adapter
- [ ] 7.13 增加 parsed Skill/prompt 应用层内容寻址缓存，缓存失败/淘汰不影响正确性
- [ ] 7.14 增加 canonical snapshot tests：对象顺序、随机 ID、时间、Fork sibling、连续 Turn、Regenerate、Skill switch 和版本升级

## 8. Observability、Evaluation 与缓存证据

- [ ] 8.1 扩展 observability allowlist/metadata，加入 Skill、Profile、stable prefix、cache policy/strategy 与 provider cache usage
- [ ] 8.2 增加 `skill.resolve`、`prompt.compile`、`skill.resource.read` Observation，默认不记录 instruction/resource body
- [ ] 8.3 验证 Langfuse/DevTools/日志均不泄漏完整 Skill 内容、管理员本地路径、reference 正文或客户端不可见 System
- [ ] 8.4 在 `evals/agent/cases/skills.json` 建立 deterministic lifecycle/security cases
- [ ] 8.5 建立 Research 多轮 case：模糊需求→目标确认→计划校准→执行→结论，并记录每轮 expected checkpoint/tool policy
- [ ] 8.6 实现 scorer：slash-clean、skill-pin、sticky、one-shot、fork-snapshot、retry/edit-pin、toolset digest、prefix digest、premature-tool
- [ ] 8.7 模型裁判分开评 goal clarity、checkpoint adherence、assumption visibility、Research/Spec boundary、decision usefulness
- [ ] 8.8 加入 smoke/CI manifest；确定性失败优先，模型质量只做独立分项，不压成单一总分
- [ ] 8.9 对比 no-skill control 与 Research treatment 的 token、TTFT、总耗时、tool count、cached token 和质量分项

## 9. 发布、文档与最终 Gate

- [ ] 9.1 更新 `.env.example`、部署文档与 `vercel-build`/VPS 流程：先 migrate，再 sync built-in Skills，再启用 UI
- [ ] 9.2 编写管理员运行手册：validate/install/sync/disable、digest 核对、版本升级、不物理删除、紧急 revoke
- [ ] 9.3 编写用户帮助：输入 `/`、sticky/one-shot、Chip、clear、Fork 继承和 Research 检查点
- [ ] 9.4 staging 手工验收：新 Project、现有 MainThread、ForkedThread、nested Fork、画布、刷新、Stop、Retry、Edit、Artifact
- [ ] 9.5 验证无 Skill 回归：普通回答、现有 Research Router、Search/Fetch、附件、Artifact、标题、计费、断流恢复
- [ ] 9.6 运行 `pnpm typecheck`、`pnpm build`、全部 Thread Chat Gate、observability、agent eval skills suite 与 `pnpm openspec:validate`
- [ ] 9.7 记录 Research SkillVersion digest、Capability Profile digest、cache policy version、评测 baseline 与发布 commit
- [ ] 9.8 先只发布内置 Research；管理员自定义 Skill 安装在 Research 纵向链路稳定后开启
