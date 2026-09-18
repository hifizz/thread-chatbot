## 1. 基线与契约

- [x] 1.1 已读取安装版本 Next.js 指南；采用官方字典 + React Context 方式，不增加候选 next-intl 依赖，也未运行格式化。
- [x] 1.2 清点首页/Auth/工作区/Admin/邮件/研究提示中的文案，确认 Locale 和错误映射唯一所有者。

## 2. 语言与双语内容

- [x] 2.1 实现服务端解析、q 权重、语言白名单、profile/cookie 同步与切换竞态处理。
- [ ] 2.2 准备完整 zh-CN/en 词典及邮件模板，增加 key/变量一致性检查。
- [ ] 2.3 接入 LanguageSwitcher、SSR 初始值、日期金额和可访问文案，不改变工作区 URL。
- [x] 2.4 审计研究/标题提示的固定语言要求，区分 UI 与回答语言。

## 3. 测试与集成

- [ ] 3.1 覆盖解析、首屏、手动覆盖、跨账号缓存、拒绝分析、邮件及错误场景。
- [ ] 3.2 手机与桌面各验收一次完整中英文准入和聊天流程。
- [ ] 3.3 实现批次运行 typecheck 和相关测试；由 develop 单独生成并验证需要的迁移。
- [x] 3.4 运行 pnpm exec openspec validate internationalization --strict；记录证据和回滚步骤。

实施记录：基础语言/字典/邮件/SSR 单元测试已执行；完整已登录手机/桌面流程、所有动态文案及 develop 迁移尚未验收，相关任务保持未勾选。具体证据见 docs/beta/i18n-implementation.md。
