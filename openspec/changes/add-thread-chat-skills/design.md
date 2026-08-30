# 设计：Thread Chat 运行时 Skill MVP

## 0. 基线与已确认决策

- 代码基线：`hifizz/thread-chatbot` 分支 `codex/feat-agent-observability-evaluation`，HEAD `48483101ad11bc84b611b615f423577633fedacb`。
- Research Skill 默认跨轮持续。
- MVP 只支持仓库内置 Skill 与管理员安装的本地 Skill 包。
- MVP 不执行 Skill 自带脚本。
- 一次只允许一个已选择 Skill。
- 缓存最大化属于核心正确性约束，不是上线后的可选优化。

当前规范化命令会在同一个数据库事务中创建 user Message 与 generating assistant Message；后台 `runGeneration` 再从 assistant Message 身份恢复运行。这个边界适合固定 SkillVersion：Skill 必须在 assistant placeholder 创建时决定，而不是在模型调用前临时读取 Thread 当前状态。

## 1. Goals / Non-Goals

### Goals

1. 用户在任意列或画布节点的 Composer 输入 `/`，可发现并选择安装好的 Skill。
2. Skill 选择是可见、可清除的结构化状态；Slash token 不污染用户原文。
3. sticky Skill 在 Thread 内跨轮、跨刷新持续；one-shot Skill 只作用于下一次新 Generation。
4. 每条 assistant Message 固定不可变 SkillVersion，支持审计、Retry/Edit 可复现和 A/B Eval。
5. Fork 在创建时继承父 Thread 当时的 sticky Skill 快照，父子后续互不影响。
6. Research Skill 的三个检查点能够跨轮工作，且不会被现有自动研究路由在第一轮强制搜索。
7. Skill references 可按需读取，但 Skill 无权自行增加工具。
8. Prompt 稳定前缀、工具集合与序列化顺序可测量、可比较，并尽可能命中供应商 Prompt Cache。
9. 不使用 Skill 的现有 Thread Chat 行为保持兼容。

### Non-Goals

- 用户上传或自行安装 Skill。
- GitHub URL、Marketplace、依赖解析或自动更新。
- 多 Skill stack、Skill 组合、子 Skill 调用或冲突解析。
- 自动从自然语言选择 Skill。
- 自动判断 Research 已完成并关闭 Skill；MVP 由用户清除或切换。
- 持久化 Research Phase/Checkpoint 状态；MVP 依赖固定 SkillVersion 与对话历史。
- 执行 `scripts/`、Shell、Python、JavaScript、安装依赖、Sandbox、Secret Broker、Approval。
- 对所有供应商保证相同缓存能力；不支持显式缓存参数的 Provider 使用规范化前缀回退。
- 重写无 Skill 时的现有 Search Router、Artifact 和 Generation 协议。

## 2. 领域模型

### 2.1 Skill

逻辑身份，例如 `research`。Skill 只负责目录身份、来源与启停，不是一次运行的可复现依据。

### 2.2 SkillVersion

不可变 Skill 包快照，包含：

```ts
type SkillActivationMode = "sticky" | "one-shot"

type SkillResourceSnapshot = {
  path: string
  mediaType: "text/markdown"
  digest: string
  content: string
}

type SkillVersionRecord = {
  id: string
  skillId: string
  version: string
  digest: string
  name: string
  description: string
  instructions: string
  resources: SkillResourceSnapshot[]
  manifest: Record<string, unknown>
  activationMode: SkillActivationMode
  capabilityProfileId: string
  sourceRef: string | null
  isCurrent: boolean
  revokedAt: Date | null
}
```

`digest` 基于规范化后的路径和 UTF-8 内容计算。任何正文、frontmatter、reference、Capability Profile 请求或 activation mode 改动都必须产生新版本，禁止原地修改已发布版本。

### 2.3 ActiveSkill

Thread 当前的 sticky SkillVersion。它是 Thread 的可变指针，不等于某次 Generation 已使用的版本。

### 2.4 Pinned SkillVersion

assistant Message 在创建时保存的 `skillVersionId`。它是本次 Generation 的事实源：

```text
Thread.activeSkillVersionId  ──发送时解析──> Message.skillVersionId
                                            ↑
                                      Generation 只读这里
```

Thread 在提交后切换 Skill，不得改变已经存在的 assistant Message。

## 3. 数据模型

### D1：MVP 使用两张 Catalog 表和两个引用字段，不新增 SkillActivation/SkillRun 表

```text
skills
  id
  slug unique
  source_type = builtin | admin
  enabled
  created_at / updated_at

skill_versions
  id
  skill_id
  version
  digest
  name / description
  manifest jsonb
  instructions text
  resources jsonb
  activation_mode
  capability_profile_id
  source_ref
  is_current
  revoked_at
  created_at

threads.active_skill_version_id nullable FK -> skill_versions.id
messages.skill_version_id nullable FK -> skill_versions.id
```

约束：

- `(skill_id, digest)` 唯一。
- 每个 Skill 最多一个 `is_current=true` 版本。
- `messages.skill_version_id` 只能出现在 assistant Message。
- 已被 Thread/Message 引用的 SkillVersion 不允许物理删除。
- `skills.enabled=false` 阻止新的选择和新 Turn；已经提交并开始的 Generation 继续使用其固定版本。
- `skill_versions.revoked_at` 阻止该版本参与新的 Start/Send/Retry/Edit；历史 DTO 与 Trace 仍可读取。
- MVP Catalog 是全局范围，不做 user/workspace installation 表。

理由：当前需求只需要一个全局管理员目录、一个 Thread 当前指针和一个 Generation 固定引用。单独的 activation history 与 SkillRun 留到需要自动 Phase、Approval 或脚本时再引入。

## 4. Skill 包与安装

### D2：运行时 Skill 与开发代理 Skill 目录隔离

建议目录：

```text
runtime-skills/
  research/
    SKILL.md
    references/
      output-template.md
      quality-checklist.md
```

`.agents/skills`、`.claude/skills`、`.codex/skills` 永不被运行时自动扫描。

### D3：MVP 支持受限 Agent Skills 兼容子集

`SKILL.md` 必须包含：

```yaml
---
name: research
description: 将模糊需求调研为可判断的工程结论
metadata:
  threadchat:
    version: 1.0.0
    activation-mode: sticky
    capability-profile: research-v1
---
```

允许：

- `SKILL.md`
- `references/**/*.md`
- UTF-8 文本
- 相对路径资源引用

拒绝：

- `scripts/` 或任何可执行文件
- symlink
- `..` 路径穿越
- 二进制文件
- 未批准 Capability Profile
- 单文件或总包超限
- 重复或非法 slug

初始限制：

- `SKILL.md` ≤ 128 KiB
- 单个 reference ≤ 128 KiB
- 总包 ≤ 512 KiB
- references ≤ 32 个

### D4：安装只走 Operator CLI

新增命令：

```text
pnpm skills:validate -- --path runtime-skills/research
pnpm skills:sync
pnpm skills:install -- --path /absolute/path/to/skill
pnpm skills:disable -- --slug research
```

- `skills:sync` 幂等导入仓库内置 Skill。
- 相同 digest 不新建版本。
- 内容变化创建新 SkillVersion，并原子切换 `is_current`。
- 既有 Thread 不自动升级。
- MVP 没有公开安装 HTTP API。

## 5. API 与命令语义

### 5.1 DTO

```ts
interface SkillVersionSummaryDTO {
  skillId: string
  skillVersionId: string
  slug: string
  name: string
  description: string
  version: string
  digest: string
  activationMode: "sticky" | "one-shot"
  capabilityProfileId: string
}

interface ThreadDTO {
  // existing fields
  activeSkill: SkillVersionSummaryDTO | null
}

interface MessageDTO {
  // existing fields
  skill: SkillVersionSummaryDTO | null // assistant only
}
```

Catalog：

```ts
interface SkillCatalogDTO {
  id: string
  slug: string
  sourceType: "builtin" | "admin"
  currentVersion: SkillVersionSummaryDTO
}
```

### 5.2 Catalog API

```text
GET /api/thread-chat/v1/skills
```

只返回 enabled Skill 的当前未撤销版本及展示元数据，不返回 instructions 或 reference 正文。响应支持 ETag/短期 HTTP 缓存。

### 5.3 Command 字段

`StartProjectCommand`：

```ts
skillVersionId?: string
```

`SendMessageCommand`：

```ts
skillVersionId?: string | null
```

三态语义：

| 值 | 含义 |
|---|---|
| omitted | 使用 Thread 当前 sticky Skill；没有则无 Skill |
| `null` | 本轮明确无 Skill，并清除 Thread 当前 sticky Skill |
| string | 显式选择该 SkillVersion；sticky 则设为 Thread 当前值，one-shot 则只固定到本次 assistant 并清除旧 sticky |

`UpdateThreadCommand` 增加：

```ts
activeSkillVersionId?: string | null
```

- 只能持久化 `sticky` 版本。
- `null` 清除。
- 选择 one-shot 只保留在 Composer draft，通过下一次 Start/Send 提交。

### D5：服务端在创建 assistant placeholder 的事务里解析 Skill

顺序：

1. 锁定 Project/Thread。
2. 解析 `skillVersionId` 三态。
3. 验证 Skill enabled、版本未撤销、Capability Profile 可用，并形成该 assistant Message 的接受时快照。
4. 更新 Thread sticky 指针。
5. 创建 user Message。
6. 创建 assistant Message，并写入最终 `skill_version_id`。
7. 返回 DTO。
8. 事务提交后启动 `runGeneration`。

任何 Skill 校验失败都必须发生在付费模型调用前。assistant Message 一旦被事务接受并启动后台 Generation，后续普通 disable 不反向改写该次运行；紧急中止沿用现有 Stop/取消机制，而不是在 Skill Catalog 层制造竞态。

## 6. Composer 与 Slash UX

### D6：Slash 只是选择入口，不是消息协议

触发规则：

- draft 的第一个非空白字符为 `/`；
- 光标位于第一个 token 内；
- 输入、删除或移动光标时实时过滤；
- Skill slug、name、description 可参与匹配。

键盘：

- `ArrowUp/ArrowDown`：移动选项；
- `Enter`：菜单打开时选择，不发送；
- `Tab`：选择当前项；
- `Escape`：先关闭菜单；
- IME `isComposing` 或 keyCode 229 时不触发选择/发送；
- `Shift+Enter` 保持换行。

选择后：

```text
[ Research × ]  帮我分析这个需求
```

- `/research` token 从 draft 删除，剩余文本保留。
- user Message 只保存“帮我分析这个需求”。
- 一次只显示一个 Skill Chip。
- busy 时禁止切换或清除 Skill。
- sticky 选择在已存在 Thread 上通过 UpdateThread 持久化；one-shot 是本地 pending 状态。
- 新 Project 尚未创建时，选择状态可写入以 Project URL UUID 为 key 的本地 draft；首条 Start 命令成功后以服务端 Thread 为事实源。
- one-shot 在 Start/Send 被服务端接受后自动清除；请求失败则保留。
- assistant Message 显示使用过的 Skill badge，至少包含 name 与 version。

### D7：列视图和画布不得维护两套 Skill 逻辑

`ConversationComposer` 是唯一交互实现；外层只传入：

```ts
activeSkill
pendingSkill
skillCatalog
onSelectSkill
onClearSkill
```

样式可按 `column/canvas` 调整，解析、键盘和命令语义必须共用纯函数/hook。

## 7. Thread 生命周期语义

### D8：Fork 复制 sticky SkillVersion，随后独立

Fork 创建事务：

```text
child.active_skill_version_id = parent.active_skill_version_id
```

- one-shot 不在 Thread 指针中，因此不继承。
- 父 Thread 之后切换/清除不影响 child。
- child 切换不影响 parent。
- 带首问 Fork 的 assistant Message 使用 child 刚复制的版本。
- 空 Fork 在未来第一次发送时使用 child 当前值。

### D9：Retry/Regenerate 与 Edit 复制历史 Generation 的 SkillVersion

- Retry/Regenerate：新 assistant Message 的 `skill_version_id` 必须复制 source assistant Message。
- Edit-and-Regenerate：如果被替代的最新 assistant 存在，新 assistant 复制其 SkillVersion；不存在时才读取 Thread 当前 sticky Skill。
- 这两个操作不修改 Thread 当前 ActiveSkill。
- 被固定版本若已 revoked/disabled，操作在模型调用前失败，不能静默升级到 current 版本。

## 8. Prompt Compiler 与缓存

### D10：稳定前缀采用规范化 block 编译

Skill 路径的模型输入顺序：

```text
1. 稳定 Tool Schema（固定 Capability Profile，名称按字典序）
2. 平台/Agent System（无随机 ID、时间戳、anchor、动态计划）
3. Skill Runtime Contract
4. Capability Profile 固定说明
5. 固定 SkillVersion 的 SKILL.md 正文
6. 按路径排序的 resource index
7. Fork 冻结历史与当前 Thread 追加式消息
8. 最新用户消息
```

Skill 指令使用明确边界包裹，并声明其优先级低于平台安全与 Action Policy。

### D11：Fork anchor 不再放入动态 System Prompt

`buildThreadChatSystem(anchorText)` 拆为稳定 System 编译器。`compileModelContext` 对 ForkedThread 的第一条 user 模型消息确定性增加 `data-quote`/等价文本 part：

```text
[本分支围绕以下原文展开]
<anchor>
...
</anchor>
```

要求：

- 数据库中的用户 text 不被改写；
- 编译结果在同一 Thread 后续请求中保持不变；
- 兄弟 Fork 在共同冻结历史末尾之前保持相同 Prompt 前缀；
- 旧数据无需回填，编译器可由 `thread.anchorText` 在内存中稳定补齐。

### D12：Skill 路径不运行当前通用 Research Router/Planner

当 assistant Message 有 `skill_version_id`：

- 直接解析 SkillVersion 与 Capability Profile；
- 不调用 `resolveResearchRoute`；
- 不调用 `createResearchPlan`；
- 不根据 latest user text 动态增减 Tool Schema；
- 不在第一 step 强制 `webSearch/readUrl`；
- 由 Skill 指令决定何时调用工具。

无 Skill 时保持当前 router/plan 行为。

理由：Research Skill 第一轮必须完成目标确认并暂停。自动 router/plan 会额外调用模型、动态改变 System 和 Tool Set，并可能在检查点前强制搜索。

### D13：Capability Profile 是服务端权限上限

MVP 固定 Profile：

```text
skill-core-v1
  readSkillResource

research-v1
  readSkillResource
  webSearch
  readUrl
  createMarkdownArtifact
```

有效工具集合：

```text
platform allowed
∩ deployment configured
∩ capability profile
```

Skill frontmatter 只能请求已批准 Profile，不能声明任意 Tool。工具对象和 JSON Schema 必须按稳定顺序编译。

### D14：references 通过只读 Tool 按需加载

```ts
readSkillResource({
  path: string
}) -> {
  path: string
  digest: string
  content: string
}
```

- 只能读取 assistant Message 固定 SkillVersion 的资源。
- 路径必须精确命中规范化资源索引。
- 不读宿主文件系统，不跟随 symlink。
- 单次返回有字符上限。
- Tool result 作为当前对话尾部内容，不进入稳定 System 前缀。

### D15：缓存标识不包含会破坏共享的运行 ID

编译器生成：

```ts
type PromptCachePlan = {
  cachePolicyVersion: string
  stablePrefixDigest: string
  capabilityProfileDigest: string
  providerStrategy:
    | "explicit"
    | "implicit"
    | "prefix-only"
    | "unsupported"
  providerCacheKey?: string
}
```

供应商缓存 key 可包含：

```text
pseudonymous user/tenant shard
provider + exact upstream model/cache identity
agent prompt version
skill digest
capability profile digest
cache policy version
```

不得包含：

```text
projectId
threadId
messageId
generationId
requestId
timestamp
anchorText
latest user text
```

不支持显式配置的 Provider 仍使用完全相同的 canonical prefix。

应用层可按：

```text
provider + exact upstream model/cache identity
+ agent prompt version
+ skill digest
+ capability profile digest
```

缓存已解析的 Skill prompt 与 Tool Schema，但缓存失效不能影响正确性。

## 9. Research 内置 Skill

### D16：Research 是第一个发布的 sticky Skill

```yaml
metadata:
  threadchat:
    version: 1.0.0
    activation-mode: sticky
    capability-profile: research-v1
```

- 第一次响应遵循 Phase A，澄清目标并等待确认。
- 后续简短确认仍在同一 SkillVersion 下运行。
- MVP 不保存结构化 phase，也不自动关闭 Skill。
- 用户通过 Chip、`/clear-skill` 或选择另一个 Skill 结束。
- Research 输出模板和质量清单拆入 references，由 `readSkillResource` 按需读取。

## 10. 安全与失败边界

### D17：Skill 只能影响被允许的 Prompt 区块

优先级：

```text
Platform/Safety/Action Policy
> Agent Runtime Contract
> SkillVersion
> Conversation/User
```

- 客户端不能提交 Skill 正文、Capability Profile、Tool Schema 或 digest。
- 服务端只接受 Catalog 中的 version ID。
- 新 Turn 遇到禁用、撤销、digest 不一致、资源损坏或 Profile 不可用时，在模型调用前终止。
- 已提交并运行中的 Generation 使用接受时固定版本；管理员普通 disable 不静默改变它的 Prompt。
- 错误不得自动回退到另一个 SkillVersion。
- 失败的 assistant Message 使用既有 failed 终态和安全错误文案。
- Catalog/观测/缓存服务故障不得泄漏 Skill 内容。

错误类别：

```text
SKILL_NOT_FOUND
SKILL_DISABLED
SKILL_VERSION_REVOKED
SKILL_CAPABILITY_UNAVAILABLE
SKILL_RESOURCE_NOT_FOUND
SKILL_PACKAGE_INVALID
```

## 11. Observability 与 Evaluation

### D18：每次 Generation 记录 Skill 与缓存 provenance

Trace/metadata 至少包括：

```text
skill.id
skill.version_id
skill.slug
skill.version
skill.digest
skill.activation_mode
capability_profile.id
capability_profile.digest
prompt.stable_prefix_digest
prompt.cache_policy_version
prompt.cache_strategy
cache.read_tokens / cache.write_tokens / cached_tokens（Provider 可用时）
```

生产默认不记录完整 instructions、resource content 或用户 Prompt。

新增 Observation：

```text
skill.resolve
prompt.compile
skill.resource.read
```

### D19：新增 `skills` Eval Suite

确定性合同：

- Slash token 不进入 Message text。
- sticky 刷新恢复。
- one-shot 只固定一次。
- Fork 复制且父子独立。
- Retry/Edit 固定历史版本。
- 发布新 current version 不改变旧 Thread/Message。
- disabled/revoked 在模型调用前失败。
- Research 激活周期 Tool Schema digest 恒定。
- Regenerate 的 stable prefix digest 相同。
- 兄弟 Fork 的共同前缀持续到冻结历史末尾。

模型质量：

- Research 第一轮目标澄清与等待确认。
- 检查点前不提前执行 Search。
- 假设、依据和 trade-off 外显。
- Research 阶段不过早给出详细实现。
- 完成后输出可供工程师判断的结论。

模型质量不覆盖确定性安全/状态失败。

## 12. Migration / Rollout

1. 添加 Catalog 与引用字段迁移；旧行全部 `null`。
2. 部署后执行 `pnpm skills:sync`，确认 Research digest。
3. 后端先上线 Catalog、命令与 Generation pinning。
4. 再上线 Composer Slash UI。
5. 以 metadata-only 观测验证普通对话、Research、Fork、Retry/Edit 与 cache digest。
6. 默认只发布 Research 一个 Skill。
7. 回滚 UI 时保留后端对已固定 SkillVersion 的执行；不物理删除 Catalog 数据。
8. 紧急禁用 Catalog 新选择时，既有版本仍按管理员 enabled/revoked 状态处理。

## 13. 验收门槛

- `pnpm typecheck`、`pnpm build`、现有 Thread Chat Gate、observability/eval tests 与 `pnpm openspec:validate` 全部通过。
- 无 Skill 的核心回答、Research Router、Fork、Stop、Retry、Edit、Artifact 行为无回归。
- Skill 相关命令具备幂等 replay 测试。
- 任何 Skill 错误均发生在正式回答模型调用前。
- Research sticky 流程可在刷新与 Fork 后继续。
- Prompt compiler 的 canonical snapshot test 稳定，不受对象插入顺序、随机 ID 或时间影响。
- 生产遥测不包含 Skill 正文或 reference 内容。

## Open Questions

无。脚本执行、自动 Phase、Marketplace、多 Skill 组合均明确延期。
