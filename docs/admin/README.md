# 管理后台与模型目录

`/admin` 使用独立权限边界和公共布局，默认进入 `/admin/models`。侧边栏改编自官方 shadcn `sidebar-08` 的 Base UI 版本；来源及 MIT 声明见 `components/admin/NOTICE.md`。

## 初始化与发布

本功能分支只修改 Drizzle schema，没有生成正式 migration。遵循 `CLAUDE.md`：由 **develop 集成任务**统一生成 migration，在空库及已有数据的升级库验证后再发布。不要直接部署本分支，也不要在生产用 `db:push` 代替迁移。

正式 migration 验证完成后，按以下顺序部署：

1. 备份数据库并应用已验证 migration：`pnpm db:migrate`。
2. 在相同数据库执行 `pnpm model-catalog:seed`，初始化现有模型及默认值。脚本可重复执行，不覆盖后台已修改的配置。
3. 发布应用代码。未初始化目录时服务返回错误，不回退到静态模型列表。
4. 让管理员先注册普通账号，再由有部署权限的人执行 `pnpm admin:grant --email admin@example.com`。脚本只授权已有账号，不提供公开提权接口。
5. 登录后访问 `/admin/models`，核对中转服务实际支持的能力与参数。

脚本读取 `.env.local`。生产执行时使用部署环境对应的配置文件，不提交凭据。`TOKEN_ROUTER_BASE_URL` 与 `TOKEN_ROUTER_API_KEY` 仍是服务端环境变量；后台不接受任意网关地址或 API key。

## 上线新模型

先在中转服务配置上游模型，再在后台新增或复制模型，填写稳定的内部 ID、实际中转模型 ID、兼容策略、能力和默认参数。内部 ID 创建后不可编辑；历史对话继续保留原 ID。启用后会出现在聊天模型菜单中，也可设为全局默认。

- 能力分别声明图片输入、工具调用、推理。PDF/文本提取仍走应用现有附件流程。
- effort 支持档位和默认值独立配置；不支持时不发送该参数。
- 输出配置包含模型上限、用户可选档位及默认值。默认值必须属于可选档位，所有档位不能超过上限。
- 上下文窗口可留空；初始化不把原配置中的推测标签当作已确认限制。
- 新建模型默认停用、能力关闭、输出默认 16,000 token，必须按上游实际支持调整。
- 兼容策略负责 OpenAI、GPT、Anthropic、DeepSeek/GLM 等不同请求字段。**现有协议内新增模型无需发版；新增协议或应用尚不支持的能力仍需代码实现。**

服务端每次生成固定一份配置快照，运行中的生成不会被后台修改影响。聊天菜单每 30 秒及重新聚焦时刷新；服务端始终校验最新启用状态。用户显式选择的参数优先，未指定时使用模型默认值；失效的旧参数会被拒绝，客户端切换模型时重新解析兼容默认值。

默认模型不能直接停用。写入配置及设置默认值均有版本冲突检测，返回 409 时刷新后重试。变更记录保存在 `model_catalog_audit`，本次未添加审计日志浏览页面。停用保留历史数据，不提供硬删除。

## 扩展其他后台页面

- `app/admin/layout.tsx`：后台鉴权入口。
- `components/admin/admin-shell.tsx`：导航、折叠、移动抽屉、页头与用户菜单。
- `constants/admin.ts`：路由和菜单定义；添加新业务页面时在这里注册入口。
- `app/admin/<feature>/page.tsx`：业务页面。读取敏感数据前自行调用 `requireAdmin()`，不能只依赖并行渲染的父 layout。
- `app/api/admin/<feature>`：独立接口，每个 handler 都鉴权，写接口校验同源 JSON。
- `lib/model-catalog`：模型领域校验、仓储、公开 DTO、请求适配；不放进通用后台组件。

后续用户分析、错误日志可复用后台外壳，分别建立自己的数据和权限边界。

## 验证

```bash
pnpm typecheck
pnpm test:admin:models
pnpm test:thread-chat:generation-settings
node --import tsx e2e/thread-chat/token-router-wire.test.mjs
node --import tsx e2e/thread-chat/image-attachment-slice.test.mjs
pnpm exec openspec validate add-admin-model-catalog --strict
```

仅在隔离的本地数据库运行有写入的测试：

```bash
ADMIN_CATALOG_TEST_WRITES=1 node --env-file=.env.local --import tsx e2e/admin/model-catalog-db.test.mjs
ADMIN_CATALOG_TEST_WRITES=1 ADMIN_TEST_CHROMIUM=/path/to/chromium node --env-file=.env.local --import tsx e2e/admin/model-catalog-browser.mjs
```

浏览器测试要求本地 Next 开发服务，`BETTER_AUTH_URL` 对应该地址，`TOKEN_ROUTER_BASE_URL=http://127.0.0.1:55433`，测试会启动模拟中转服务。测试注册专用账号并保留验收数据，不能指向共享开发库。

本次已通过类型检查、相关单元/SDK 序列化测试，以及隔离 PGlite 上的实际 Drizzle 读写、初始化幂等、审计、版本冲突、默认模型保护。浏览器完成真实登录、管理员门禁、新增/编辑/默认/停用、手机导航，并验证聊天实际发送新的上游 ID、默认 effort 和 token、工具关闭时不发送 tools，无页面异常。

验收使用 Chromium、PGlite 和模拟上游。测试环境通过本地字体资源替代受限的 Google Fonts 下载，未修改产品字体代码。**这不替代正式 PostgreSQL 迁移/并发锁测试，也不表示真实模型供应商调用或生产部署已验证。**

页面截图：

- [桌面模型目录](screenshots/models-desktop.png)
- [能力与默认值编辑](screenshots/model-editor.png)
- [手机导航](screenshots/models-mobile-navigation.png)
- [聊天配置生效](screenshots/chat-config-applied.png)
