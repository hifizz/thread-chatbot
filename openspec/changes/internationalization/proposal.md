## Why

对外 Beta 需要稳定的中文、英文首屏和通知，当前界面、错误、研究提示混有固定中文。先确定语言和错误契约，才能让准入、额度、隐私弹窗使用同一套翻译方式。

## What Changes

- 增加 zh-CN/en 两套消息目录及服务端语言解析，保持现有工作区 URL 不变。
- 提供手动切换、登录偏好同步、双语交易邮件和公开错误码翻译。
- 分离界面语言与 AI 回答语言，审计研究及标题提示，不改写历史消息。
- 增加 Beta 总依赖图、公共契约所有权和开放检查入口，供其余七项方案引用。

## Capabilities

### New Capabilities

- `internationalization`: 语言识别、双语文案、SSR 一致性及通知语言。

### Modified Capabilities

无。既有能力的实现接入在本 change 的 tasks 中列出，不直接修改已发布规范。

## Impact

计划涉及 app/layout、现有设置菜单、消息目录、错误映射、邮件模板和 constants/research.ts；复用现有 Base UI/shadcn 组件。实现前按仓库要求读取所安装 Next.js 文档，核对 next-intl 兼容版本并声明直接依赖。本 PR 仅提交文档，不安装依赖、不更改业务或生成 migration。

## Dependencies

- Git 基线：main@5731a9d0fd293ab47b35152842517dc7ae0f956a。
- 无前置功能依赖；隐私、准入文案和产品分析依赖本契约。
- 本 change 携带 docs/beta/README.md 和 contracts.md；公共契约不意味着新建通用框架。

## Non-goals

不增加 CMS、自动机器翻译、独立繁体词典、工作区语言路由前缀或强制翻译历史聊天。
