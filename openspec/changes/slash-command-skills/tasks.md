# Tasks: slash-command-skills

## 1. 定义层：Skill 文件、加载器与元数据接口

- [x] 1.1 添加 `gray-matter` 依赖；新建 `constants/skill.ts`（触发字符 `/`、directive type `skill`、目录名等常量）
- [x] 1.2 新建 `lib/skills/types.ts`（`SkillMeta`、`SkillDefinition` 类型）与 `lib/skills/registry.ts`（扫描 `skills/*/SKILL.md`，gray-matter 解析、校验 id 与目录名一致及必填字段、非法项告警跳过，模块级缓存注册表，导出 `getSkillMetas()` / `getSkillById(id)`）
- [x] 1.3 编写示例 skill：`skills/translate/SKILL.md` 与 `skills/summarize/SKILL.md`（frontmatter + 中文 prompt 正文，正文含「用户消息中的 /<id> 指令表示按本技能处理其后文本」说明）
- [x] 1.4 新建 `app/api/skills/route.ts`：GET 返回元数据数组（不含正文与 tools），无 skill 时返回空数组；`pnpm typecheck` 通过并用 curl 验证响应

## 2. 触发层：Composer 弹层与 chip 渲染

- [x] 2.1 新建 `lib/skills/use-skills.ts`（客户端 hook：fetch `/api/skills`，返回 `{ skills, isLoading }`）与 `lib/skills/trigger-adapter.ts`（由元数据构造 `Unstable_TriggerAdapter`：单一「Skills」category、`search()` 按 label/id 过滤）
- [x] 2.2 在 `components/assistant-ui/thread.tsx` 的 Composer 中包 `ComposerPrimitive.Unstable_TriggerPopoverRoot`，挂 `<ComposerTriggerPopover char="/" adapter isLoading directive={{}} />`
- [x] 2.3 将 user message 的 `Text` 消息部件替换为 `directive-text.tsx` 的 `DirectiveText`，使 `:skill[...]` 渲染为 chip
- [x] 2.4 浏览器验证：输入 `/` 弹菜单、输入过滤、键盘导航、选中插入 chip、发送后消息中显示 chip、刷新页面后历史 chip 回显；`pnpm typecheck` 通过

## 3. 执行层：route.ts 解析与注入

- [x] 3.1 新建 `lib/skills/resolve.ts`：用 `@assistant-ui/core` 的 `unstable_defaultDirectiveFormatter.parse()` 从最后一条 user message 提取第一个 type 为 `skill` 的 directive 并查注册表（未注册返回 null）；提供 `sanitizeSkillDirectives(messages)` 将全部消息文本中的 directive 替换为 `/id`
- [x] 3.2 在 `constants/` 提取基础 system prompt 常量；修改 `app/api/chat/route.ts`：解析 → 白名单校验 → system = 基础 + 空行 + skill 正文 → 按 frontmatter `tools` 从 `skillTools` 映射启用增量工具 → 清洗后再 `convertToModelMessages`
- [x] 3.3 端到端验证：`/translate` 触发后模型行为符合 skill 正文；历史消息含 directive 但最后一条不含时不注入；伪造未注册 id 正常降级；数据库中消息保持原始 directive 文本；`pnpm typecheck` 通过

## 4. 收尾

- [x] 4.1 磁贴打磨：菜单空态/加载态文案、iconMap 映射示例 skill 图标
- [x] 4.2 按 CLAUDE.md 规范 sweep 魔法字符串与重复逻辑（常量归 `constants/`、工具函数归 `lib/skills/`）；`pnpm lint`、`pnpm typecheck`、`pnpm format` 全通过
- [x] 4.3 `pnpm openspec:validate` 通过；在 CLAUDE.md 增补 skill 机制一节（定义位置、如何新增 skill）
