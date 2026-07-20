# StartChatButton 原生元素语义修复设计

## 问题

`StartChatButton` 通过 Base UI `Button` 的 `render` 槽渲染 Next.js
`Link`，最终根元素是 `<a>`。Base UI `Button` 默认设置
`nativeButton=true`，因此开发环境报告根元素与声明的原生按钮语义不一致。

## 方案

仅在 `components/landing/start-chat-button.tsx` 的 `Button` 调用处添加
`nativeButton={false}`。保留 `Link` 导航语义、现有样式、服务端组件边界及默认
CTA 行为，不修改共享 `components/ui/button.tsx`。

该实现与仓库中 `app/account/page.tsx` 和
`components/ui/pagination.tsx` 的链接型按钮写法一致。

## 验收

- `StartChatButton` 继续渲染为可导航的 `<a>`。
- Base UI 不再报告 `nativeButton` 与根元素不匹配。
- `pnpm typecheck` 通过。
- 针对改动文件的 ESLint 检查通过。

## 非目标

- 不改变全局 `Button` 默认值。
- 不重构落地页 CTA 或导航流程。
- 不改变视觉样式。
