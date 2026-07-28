## Why

当前公开首页的内容和视觉仍像一张功能展示页，无法在首屏建立 Thread Chat 的核心判断：AI 对话中的思考不应被迫保持单线。产品已具备分支、持久树、工作台与 Markdown 沉淀能力，现在需要一张与产品气质一致、能引导访客开始对话的精品首页。

## What Changes

- 将 `/` 重排为“视频证据 → 产品观点 → 为什么构建 → 为什么现有聊天工具不足 → CTA”的编辑式叙事首页，替换全部现有首页 UI 风格与 section 编排。
- 新增响应式 Hero 视频容器和缺省占位状态；视频资源以后可直接放入 `public/` 替换，不阻塞页面上线。
- 复用 `/thread-chat` 的暖黄背景、黑色文字和绿色交互语义，避免引入第二套品牌主题。
- 用明确的产品文案解释 Thread Chat 与 ChatGPT/Codex 临时 thread/branch 的区别：锚点上下文继承、主线保持清晰、工作台与树的持久化、分支生成 Markdown。
- 收敛导航为品牌标识和单一 `Get started` CTA；页脚提供必要法务、代码仓库与版权信息。

## Capabilities

### New Capabilities

- `landing-page-experience`: 提供公开、响应式、视频驱动的 Thread Chat 产品首页，并明确传达产品定位、差异化与开始使用路径。

### Modified Capabilities

（无现有基线规格；本变更新增首页体验合同。）

## Impact

- `app/page.tsx`、`components/landing/*`、`components/landing/landing.module.css`、`constants/landing.ts` 与首页 metadata。
- `public/` 将预留可替换的 Hero MP4 路径及静态缺省呈现，不新增外部服务或依赖。
- 既有 `/thread-chat` 业务、认证流程、数据模型和 API 不变；首页 CTA 复用已有开始聊天路由。
