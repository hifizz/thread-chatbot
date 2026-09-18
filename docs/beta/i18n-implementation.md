# 国际化实施记录

## 本轮实现

- 单一 Locale 白名单、按 q 值解析浏览器语言、显式账户/设备偏好和请求级 SSR 初始化。
- 当前账户的 locale 字段、同源白名单写入 API、256 字节流式请求体限制、串行切换与失败时设备/账户状态区分。
- 首页、六个静态演示、邮箱登录/注册/重置、账户、Admin 外壳及主要 Thread/Artifact/搜索/图表操作的双语词典接入。
- 交易邮件支持中文/英文 subject/html/text，并转义模板变量；邀请等未来模块可复用具名模板。
- 正式 Generation 在 HTTP 发起时冻结界面语言；用户明确要求和对话语言优先，不自动翻译历史内容。
- 稳定公开错误码映射、金额/日期格式和 SSR 字典缺项检查。

采用 Next.js 官方字典模式和已有 React Context/Intl；不增加 next-intl 或第二个语言配置源。

## 已执行验证

在恢复的仓库和锁文件依赖上执行：

```sh
node --import tsx e2e/beta/i18n.test.mjs
node --import tsx e2e/beta/i18n-ui.test.mjs
node node_modules/@fission-ai/openspec/bin/openspec.js validate internationalization --strict
```

基础 8 项测试与 SSR/场景 3 项测试通过。TypeScript 与剩余 lint/浏览器证据以本 PR 最新 CI 为准，不把较早提交的结果当成当前代码结果。

本地 Chromium 被运行环境策略阻止访问 localhost，未将其标记为浏览器通过；新增 `e2e/beta/i18n-browser.mjs` 可在隔离 PostgreSQL 的 CI 中检查真实账户偏好与手机/桌面页面。必须查看对应运行结果。

## 未完成或仍需外部验收

- 完整已登录聊天/工具流程和所有历史/第三方组件的动态文案仍须逐页验收；不能仅凭词典有 key 宣称所有页面已翻译。
- locale 的真实部署迁移只能在 develop 集成阶段生成和升级验证。本分支没有修改 `drizzle/`；未生成迁移前不直接部署到现有数据库。
- Waiting List、Cookie、计费等后续方案当前只有可复用双语词条；其功能实现仍在各自 PR，不把文案当成已实现功能。

## 回滚

回滚到前一应用镜像，保留兼容的可空 locale 字段和用户偏好；不要删除用户数据。语言 cookie 名为 `tc-locale`，只记录显式选择或账户同步，保存一年、SameSite=Lax、HTTPS 下 Secure。它不记录分析行为。
