# landing-page 公开落地页

## ADDED Requirements

### Requirement: 公开可访问的落地页

根路由 `/` SHALL 渲染一张**公开落地页**，不做任何鉴权——登出访客与已登录用户都能看到，绝不因未登录而重定向。页面 SHALL 可静态渲染（不读取会话），以便 CDN 缓存。线性聊天 SHALL 不再挂载在 `/`。

#### Scenario: 登出访客访问根路由

- **WHEN** 未登录用户访问 `/`
- **THEN** 返回落地页内容（Hero、CTA、卖点段落），HTTP 200，不发生跳转到 `/sign-in`

#### Scenario: 已登录用户访问根路由

- **WHEN** 已登录用户访问 `/`
- **THEN** 同样返回落地页（不强制跳走），页面不再是 assistant-ui 线性聊天

### Requirement: 主 CTA 进入旗舰

落地页 SHALL 提供主 CTA「开始聊天」，其目标 SHALL 是旗舰路由 `/thread-chat`（经路由常量，不硬编码字面量）。CTA SHALL 不在客户端自行生成 treeId——由旗舰跳板负责生成新树。

#### Scenario: 点击开始聊天

- **WHEN** 访客点击落地页主 CTA「开始聊天」
- **THEN** 导航到 `/thread-chat`（未登录则由旗舰门禁接管跳登录，见 flagship-access）

### Requirement: 卖点内容呈现 thread-chat 差异化且数据驱动

落地页 SHALL 呈现 thread-chat 的核心差异化——**划选 AI 回复即开分支**与**画布工作台**——而非泛泛的"又一个聊天框"。全部文案/结构内容 SHALL 来自集中的内容常量（`constants/landing.ts`），使视觉/文案细化不需改动组件结构。

#### Scenario: 页面含差异化卖点

- **WHEN** 访客浏览落地页
- **THEN** 能看到"划选开分支"的交互示意段落与"画布工作台"的展示段落

#### Scenario: 内容来自常量

- **WHEN** 修改 `constants/landing.ts` 中的标题/副标题/卖点文案
- **THEN** 落地页对应文字随之更新，无需改动任何 `components/landing/*` 组件的结构
