# Design: Slash Command 触发 Skill

## Context

项目是 Next.js 16 App Router + assistant-ui + AI SDK v7（MiniMax 后端，`app/api/chat/route.ts` 中 `streamText`）。消息以完整 `UIMessage` JSONB 持久化在 Postgres（`messages.content`）。仓库已 vendor 了 assistant-ui 的两个配套组件：`components/assistant-ui/composer-trigger-popover.tsx`（触发弹层成品 UI）与 `components/assistant-ui/directive-text.tsx`（directive 语法 chip 渲染），底层依赖 `@assistant-ui/react` 的 `Unstable_TriggerPopover` / `Unstable_TriggerAdapter` / `unstable_defaultDirectiveFormatter` API（pre-1.0 不稳定）。

概念分层（详见会话讨论的结论）：

- **触发层**（纯前端）：`/` 弹菜单、过滤、选中、chip 渲染。
- **定义层**（服务端资产）：`skills/<id>/SKILL.md`，frontmatter 元数据 + prompt 正文。
- **执行层**（服务端）：解析 directive → 注入 system → 启用工具。

## Goals / Non-Goals

**Goals:**

- 用户可通过 `/` 在输入框中发现并触发 skill，单条消息生效。
- Skill 正文只存在于服务端，前端只见元数据（progressive disclosure）。
- 不改数据库 schema，不改传输层；skill 引用作为消息文本自然持久化。
- 为后续扩展（更多 skill、skill 声明工具）留好接口。

**Non-Goals:**

- 会话级 sticky skill（整个 thread 固定某模式）——将来走 transport body 方案，另立 change。
- 一条消息叠加多个 skill。
- 用户自定义/数据库存储的 skill、skill 市场。
- 客户端立即执行型命令（如 `/clear`，即 trigger 的 `action` 行为）。

## Decisions

### D1：Skill 本体放服务端文件系统（`skills/<id>/SKILL.md`）

理由：prompt 是与模型调用绑定的资产，注入点在 `route.ts`；文件进仓库可 review、可版本控制；`tools` 声明引用的服务端工具本来就在服务端。
备选：放数据库（留给用户自定义 skill 阶段）；硬编码在前端（正文随请求上传、可被篡改、无法做工具授权，否决）。
frontmatter 用 `gray-matter` 解析（新依赖，成熟且零传染）。

### D2：传输通道用「directive 随消息正文走」，不动传输层

选中 skill 后以 `unstable_defaultDirectiveFormatter` 的 `:skill[label]{name=id}` 语法插入输入框，作为普通 user message 文本发送；服务端解析最后一条 user message。
理由：零额外通道；JSONB 持久化免费；编辑/重发消息时 skill 语义自动跟随；历史自解释。
备选：`AssistantChatTransport` 的 `prepareSendMessagesRequest` 挂 `skillId`——skill 状态脱离消息本身，持久化/重发/回放都要额外处理，仅适合将来的 sticky 模式，否决。

### D3：服务端解析复用 `@assistant-ui/core` 的 formatter

`route.ts` 从 `@assistant-ui/core` 引入 `unstable_defaultDirectiveFormatter.parse()` 解析与清洗，不引 react 包、不自写正则，保证前后端语法一致。解析范围：只取最后一条 user message；多个 directive 只取第一个；type 必须为 `skill`。

### D4：注入方式为「基础 system + 空行 + skill 正文」

不伪造 user/system message 插入历史，避免污染消息记录。当前 `route.ts` 无显式 system，需先提一个 `constants/` 里的基础 system 常量再拼接。清洗：发给模型的全部消息文本中 `:skill[...]{name=id}` 替换为 `/id`（`convertToModelMessages` 之前对 UIMessage 文本做替换），数据库内容不动——持久化发生在前端 history adapter，天然不受影响。

### D5：工具启用走注册表映射

`route.ts` 维护 `skillTools: Record<string, Tool>`（服务端工具名 → 实现）；skill frontmatter 的 `tools: [name]` 只能引用该映射中的键，未知名忽略并告警。基础工具（`getWeather`、`compareTable`、frontendTools）始终可用，skill 工具是增量。

### D6：前端数据流

`GET /api/skills` → SWR 式 hook（简单 `useEffect` + state 即可）→ 构造同步 `Unstable_TriggerAdapter`（单一 category「Skills」，`search()` 按 label/id 过滤）→ `<ComposerTriggerPopover char="/" adapter directive={{}} isLoading />`。`thread.tsx` 的 Composer 需包 `ComposerPrimitive.Unstable_TriggerPopoverRoot`；user message 的 `Text` 组件替换为 `DirectiveText`。

### D7：安全

skillId 只用于注册表 Map 查询，绝不拼路径读文件；加载器只在启动扫描 `skills/` 一层目录。未注册 id 静默降级为普通消息。

## Risks / Trade-offs

- [assistant-ui `Unstable_*` API 变动] → 锁定 `@assistant-ui/*` 版本；此功能列入升级回归清单；包装层集中在 `composer-trigger-popover.tsx`，变动时只改一处。
- [模型看到 `/id` 但不知其含义时可能困惑] → skill 正文注入 system 时附一句「用户消息中的 /<id> 指令表示按本技能处理其后文本」。
- [directive 语法被用户手打伪造] → 语法本身无特权：伪造合法 id 等同正常触发；伪造非法 id 被白名单忽略。可接受。
- [dev 模式文件缓存导致改 SKILL.md 不生效] → 缓存键挂在 `globalThis` 之外的模块级即可随 HMR 失效；文档注明改 skill 后重启 dev server 最稳妥。
- [注册表在无 `skills/` 目录时] → 返回空注册表，接口回空数组，前端菜单显示空状态，全链路不报错。

## Migration Plan

纯增量功能，无数据迁移。分四步落地（见 tasks.md），每步可独立验证；回滚即 revert 对应 commit，不影响既有对话数据。

## Open Questions

- skill 的 `icon` 字段取值约定（lucide 图标名字符串）是否够用——首版按 iconMap 键约定，缺失走 fallback 图标。
- MiniMax 对较长 system prompt 的敏感度未知，示例 skill 正文先控制在 ~200 token 内，后续观察。
