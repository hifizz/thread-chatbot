# Slash Command 触发 Skill

## Why

目前模型的行为只能靠用户每次手写 prompt 来引导，常用的任务模式（翻译、总结等）无法沉淀复用。需要一套 Skill 机制：把结构化的 prompt 资产放在服务端统一管理，用户在输入框里通过 `/` 唤起菜单、主动触发，让单条消息以某个预设"技能"的方式被处理。

## What Changes

- 新增服务端 Skill 定义体系：`skills/<id>/SKILL.md` 文件（YAML frontmatter 元数据 + Markdown prompt 正文），由 `lib/skills/` 加载器解析并缓存为注册表。
- 新增 `GET /api/skills` 路由，仅暴露 skill 元数据（id、label、description、icon），不下发正文（progressive disclosure）。
- Composer 输入框接入 assistant-ui 的 `Unstable_TriggerPopover`（触发字符 `/`），基于已 vendor 的 `composer-trigger-popover.tsx` 弹出 skill 选择菜单；选中后以 directive 语法 `:skill[label]{name=id}` 插入输入框。
- 用户消息中的 directive 语法用已 vendor 的 `directive-text.tsx` 渲染为 chip 徽章，历史消息（JSONB 持久化）重新加载后照常渲染。
- `POST /api/chat`（`app/api/chat/route.ts`）解析最后一条 user message 中的 skill directive：经注册表白名单校验后，将 skill 正文追加注入 system prompt，并按 frontmatter 声明启用额外工具；发送给模型的文本中 directive 语法被替换为可读形式（`/id`）。
- 生效范围为单条消息；一条消息最多识别一个 skill（只取第一个 directive）。
- 内置两个示例 skill（`translate`、`summarize`）作为验收载体。

## Capabilities

### New Capabilities

- `skill-definitions`: 服务端 Skill 的定义格式（SKILL.md frontmatter + 正文）、加载与注册表缓存、`GET /api/skills` 元数据接口。
- `skill-slash-command-ui`: 输入框 `/` 触发的 skill 选择菜单交互，以及消息中 skill directive 的 chip 渲染（含历史消息回显）。
- `skill-invocation`: 聊天后端对 skill directive 的解析、白名单校验、system prompt 注入、工具启用与发给模型前的语法清洗。

### Modified Capabilities

（无——openspec/specs/ 下暂无既有能力规格。）

## Impact

- **新增目录/文件**：`skills/`（skill 定义）、`lib/skills/`（类型、加载器、解析）、`app/api/skills/route.ts`、`constants/skill.ts`。
- **修改**：`app/api/chat/route.ts`（注入与工具启用）、`components/assistant-ui/thread.tsx`（Composer 挂 TriggerPopoverRoot + 弹层、user message 的 Text 组件替换为 DirectiveText）。
- **依赖**：新增 `gray-matter`（解析 frontmatter）；依赖 `@assistant-ui/react` 的 `Unstable_*` trigger API（pre-1.0 不稳定 API，需锁版本）。
- **数据库**：无 schema 变更——skill 引用作为消息文本的一部分随 `messages.content` JSONB 天然持久化。
- **不受影响**：reasoning middleware、frontendTools 链路、线程持久化适配器。
