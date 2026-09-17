## Context

方案基于 main@5731a9d；现有 Next.js、React、Base UI 组件与 Resend 依赖继续复用。这里只定义设计，以下 TypeScript 是拟议契约，不代表已实现。

## Goals / Non-Goals

目标是首屏、交互、错误、邮件语言一致且可手动覆盖。非目标见 proposal；不建立第二套用户资料或错误系统。

## Decisions

### 1. 用户路径与语言优先级

工作区 URL 保持不变。服务端按“已登录用户明确偏好 → 已验证的语言 cookie → Accept-Language 按 q 权重匹配 → en”解析。忽略 q=0；zh 及 zh-* 映射到当前唯一中文词典 zh-CN，其他支持的英文标签映射 en。暂不声称支持繁体。

手动选择后 cookie 立即生效；登录用户同时保存资料偏好，成功后刷新服务端视图。资料保存失败保留当前设备选择并显示可重试提示，不显示已跨设备同步。未登录与已登录缓存不得串语言或串用户。SSR 与客户端接收同一个初始 locale，不等待 localStorage 再换文案。

### 2. 模块与组件

| 所有者 | 输入 → 输出 | 不负责 |
| --- | --- | --- |
| constants/i18n.ts | 支持语言常量 → Locale | 用户权限 |
| lib/i18n/resolve-locale.ts | profile/cookie/header → LocalePreference | 浏览器定位 |
| messages/zh-CN.json、en.json | 稳定 message key → 文案 | 后端业务分支 |
| lib/i18n/errors.ts | 公开 error code → message key | 原始供应商错误展示 |
| 现有邮件模块的 templates | locale/template/variables → subject/html/text | 重试及投递状态 |
| LanguageSwitcher | 用户选择 → preference mutation | 第二套设置页面 |

next-intl 作为实现候选，版本由实现时锁文件确认。词典按功能 namespace 分组，不让每个模块复制一份 Locale。移动端复用已有 Drawer；可访问标签、toast、空状态、时间和费用格式一起翻译。

### 3. 类型与 DTO

```ts
export type Locale = 'zh-CN' | 'en';
export type LocalePreference = {
  locale: Locale;
  source: 'profile' | 'cookie' | 'accept-language' | 'default';
};
export type UpdateLocaleInput = { locale: Locale };
export type UpdateLocaleResult = {
  locale: Locale;
  persisted: 'device' | 'account';
};
export type LocalizedEmailInput = {
  locale: Locale;
  template: 'beta-invite' | 'invite-expired' | 'credit-low';
  variables: Record<string, string>;
};
export type ResponseLanguagePolicy = {
  uiLocale: Locale;
  explicitUserLanguage: string | null;
  conversationLanguage: string | null;
};
```

HTTP 输入用 Zod 验证语言枚举，拒绝任意词典路径。拟议 PATCH /api/settings/locale 消费现有身份验证、CSRF/来源校验；匿名只设置经过白名单验证的 cookie。返回语言与保存范围，不泄露资料。公开错误采用 code/requestId/retryAfterSeconds；错误码业务所有者见 docs/beta/contracts.md。

### 4. 数据与状态

在现有用户资料增加可空 locale；null 表示未明确选择，不回填猜测地区。cookie 只保存 locale，Secure/SameSite/生命周期由实际 HTTPS 配置统一；不得存整份 profile。用户选择是偏好功能，不以 analytics 授权作为前置；其存储用途需隐私文档明确。

切换状态：idle → saving → saved 或 failed。重复相同选择无副作用；不同选择采用版本/请求序号防止旧响应覆盖新选择。登录时账户明确偏好优先并同步 cookie；退出登录不保留上一用户身份。

### 5. 回答语言与两套文案

用户明确要求的语言优先，其次沿用当前对话语言，最后使用界面语言作为新对话默认。不能用英文 UI 强制回复英文，也不能保留固定“组织中文答案”的研究限制。只传稳定 locale 与必要语言信号，不为每次请求随机重写系统提示破坏缓存。

实现交付必须包含首页、Auth、Waiting List、邀请失效/撤销、模型受限、余额不足、搜索故障、停止/恢复、Cookie、反馈、Admin 核心页的完整双语文案。模板变量必须两边一致，邮件按申请/邀请保存的 locale 发送，不能随 worker 的服务器语言变化。

### 6. 观测、安全和验收

语言切换失败记录 requestId、错误码、release，不记录整份 cookie。可选切换行为事件仅在 analytics 授权后发送；词典缺 key 是发布错误，不静默显示 key。测试覆盖 q 权重、q=0、zh-TW、非法 cookie、手动偏好、跨账号缓存、双语邮件变量与英文 UI 下中文提问。

## Migration Plan

功能分支只改 schema 设计/源码并在独立库 db:push；迁移只能由 develop 集成任务生成和验证，main 接收已验证迁移。本 PR 不产生任何 SQL。先发布兼容的可空字段和词典，再开启切换；保留现有 URL。回滚保留 locale 数据并用已知语言回退，不删除用户偏好。

## Risks / Trade-offs

无 URL 前缀降低改动但不解决多语 SEO；作为后续独立需求。语言不是地理位置，也不能决定隐私规则。第三方组件隐藏文案可能遗漏，需浏览器验收。

## Open Questions

无阻断性的架构问题。实现时确定 next-intl 的兼容版本和实际语言 cookie 保存期，并记录在配置与隐私清单；未验证依赖版本不得宣称已验收。
