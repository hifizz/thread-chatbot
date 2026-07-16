# flagship-access 旗舰访问门禁

## ADDED Requirements

### Requirement: 旗舰路由服务端鉴权门禁

`/thread-chat` 与 `/thread-chat/{treeId}` SHALL 由服务端 `app/thread-chat/layout.tsx` 统一做鉴权：`getSession()` 判定未登录时 SHALL `redirect` 到 `/sign-in?redirect=/thread-chat`（redirect 目标经路由常量构造、URL 编码）。已登录时 SHALL 正常渲染旗舰页。门禁 SHALL 用服务端 layout 实现，不引入 middleware。

#### Scenario: 未登录访问旗舰跳板

- **WHEN** 未登录用户访问 `/thread-chat`
- **THEN** 服务端 302 到 `/sign-in?redirect=%2Fthread-chat`，不渲染旗舰内容

#### Scenario: 未登录直访具体树 URL

- **WHEN** 未登录用户直接访问 `/thread-chat/<uuid>`
- **THEN** 同样被 layout 拦截跳登录（不靠 API 层 401 兜底）

#### Scenario: 已登录正常进入

- **WHEN** 已登录用户访问 `/thread-chat`
- **THEN** 正常渲染，跳板 replace 到 `/thread-chat/{新uuid}` 开新树

### Requirement: 登录/注册默认落点为旗舰

登录/注册成功后，当 URL 无 `redirect` 参数时，默认落点 SHALL 是旗舰 `/thread-chat`（不再是 `/`）。该默认值 SHALL 来自路由常量单一事实来源，邮箱登录、注册、Google OAuth 回调三条路径一致。

#### Scenario: 无 redirect 参数登录

- **WHEN** 用户在 `/sign-in`（URL 无 `redirect` 参数）登录成功
- **THEN** 跳转到 `/thread-chat` 而非 `/`

#### Scenario: 带 redirect 从门禁回跳

- **WHEN** 用户经 `/sign-in?redirect=/thread-chat` 登录成功
- **THEN** 跳回 `/thread-chat`

### Requirement: 落地页到旗舰的登录编排

登出用户从落地页 CTA 进入旗舰时，整条链路 SHALL 是：CTA → `/thread-chat` → 门禁跳 `/sign-in?redirect=/thread-chat` → 登录成功 → 回到 `/thread-chat` 跳板生成新树。全程无死循环、无停在错误态。

#### Scenario: 登出用户经 CTA 首次进入

- **WHEN** 登出访客在落地页点「开始聊天」并完成登录
- **THEN** 最终停在 `/thread-chat/{新uuid}`，可正常发起分支对话
