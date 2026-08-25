<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project instructions

Before working in this repository, read `CLAUDE.md` in full and follow its
project-wide instructions. `CLAUDE.md` is the single source of truth for shared
development commands, workflow rules, architecture, and implementation notes.

If an instruction in this file conflicts with `CLAUDE.md`, follow this file.

## 交付物卫生规则

### 注释

- 注释只写「从代码本身看不出来的为什么」（non-obvious why）
- 禁止出现：修改历史、曾经的做法、"原本/之前/改为"、本次对话中讨论过的内容
- 不为「没有做的东西」写注释或测试，
  唯一例外：该空缺会被后来者误认为 bug 并试图"修复"时，
  才允许一句话说明这是有意的（intentionally absent）

### PR / Commit

- 标题与描述只描述最终行为：这个 diff 让系统变成了什么
- 禁止出现：被否决的方案、中间尝试、「应要求移除了 X」之类的痕迹
- 用户的反馈已经体现在 diff 里，不需要文字复述

### 文档 / UI 文案

- 只服务产品和读者，禁止写入思考过程、实现理由、调试记录、下一步计划
- 内容只保留最终状态，不带讨论痕迹

### 提交前自检（每行新增文本都要过一遍）

问：「一个从没看过这场对话的工程师，只看最终代码，
这行文字还提供增量信息吗？」
答「否」→ 删掉。
