# 替换首页：`/` 改为可交互的 ThreadChat 演示首页

## Why

编辑式长文首页无法让访客直观理解产品的核心价值：从回答里的一句话开分支、主线与分支并排阅读、通过分支树找回来路、再用 @Artifact 把结论带回主线。需要把 `/` 换成一张「演示驱动」的首页——用高保真复刻 `/thread-chat` 三列交互的本地剧本演示，让访客在注册前就看懂「开得轻、读得清、找得到、带得回来」。

## What Changes

- 撤销历史 PR #127 的首页实现（revert 提交 `857049ba`），在其基线上重新实现，而非搬回旧代码。
- `/` 重排为：导航 → Hero（「一款能开分叉的 AI」）→ 场景交互演示 → 功能解释 → FAQ（9 问）→ 底部 CTA → 法律链接。
- 五类场景标签、六套静态剧本（写 PRD / 技术方案 / 营销方案 / 深度调研 / 自学 AI / 看懂上市公司）共用一个三列演示窗口；演示是纯前端预设内容，不调用真实模型、不创建会话、不写用户数据。
- 演示播放器支持播放/暂停/重播/章节跳转，状态由（场景, 章节, 揭示进度）折叠派生，任意章节可直达完整画面；来源短语可点击手动展开分支；技术场景完整演示子分支结论 → Artifact → 主线 `@` 引用 → 发送 → 继续回答。
- 视觉复刻 `/thread-chat`：奶黄色纸面 token、三列布局、分支深度色、划选锚点高亮 + 脚注、来源横幅、Artifact 卡片与 composer 胶囊。
- 首页所有 GitHub 仓库链接移除；保留真实「开始使用」（`/start-chat`）、隐私政策与服务条款。
- 顺手修复 `lib/axiom/server.ts` 的 `prefer-const` lint 错误（`let queue` → `const queue`，无行为变化），使 `pnpm lint` 零 error。

## Capabilities

### New Capabilities

- `interactive-homepage`: 公开首页提供剧本驱动的三列交互演示，覆盖五类场景六套剧本，支持章节导航、暂停/重播、来源短语展开与 @Artifact 回流主线。

### Modified Capabilities

（无；本变更替换首页呈现，不改既有 spec 的行为合同。）

## Impact

- `app/page.tsx`、`components/landing/*`（重写）、`components/landing/demo/*`（新增）、`constants/landing.ts`（重写）、`constants/landing-demo.ts`（新增剧本数据）、`components/landing/landing-demo.css`（演示隔离样式）。
- `lib/axiom/server.ts` 一行 lint 修复。
- 不改 `/thread-chat` 业务代码、认证、数据库、API；不新增依赖；演示样式全部收敛在 `.ld` 作用域，不污染 `.tc`。
