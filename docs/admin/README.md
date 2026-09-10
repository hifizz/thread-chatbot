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

先在中转服务配置上游模型，再在后台新增或复制模型，填写稳定的内部 ID、实际中转模型 ID、兼容策略、能力和默认参数。内部 ID 创建后不可编辑；历史对话继续保留原 ID。启用后会在运行时缓存刷新、用户重新打开页面取得新目录后出现在菜单，也可设为全局默认。

- 能力分别声明图片输入、工具调用、推理。PDF/文本提取仍走应用现有附件流程。
- effort 支持档位和默认值独立配置；不支持时不发送该参数。
- 输出配置包含模型上限、用户可选档位及默认值。默认值必须属于可选档位，所有档位不能超过上限。
- 上下文窗口可留空；初始化不把原配置中的推测标签当作已确认限制。
- 新建模型默认停用、能力关闭、输出默认 16,000 token，必须按上游实际支持调整。
- 兼容策略负责 OpenAI、GPT、Anthropic、DeepSeek/GLM 等不同请求字段。**现有协议内新增模型无需发版；新增协议或应用尚不支持的能力仍需代码实现。**

服务端在请求入口取得一次配置，再显式传给同步校验、附件编译及生成；运行中的生成不会被后台修改影响。每实例缓存五分钟，过期请求先返回旧对象，通过 Next.js `after` 在响应结束后刷新；并发只调度一次。失败保留旧值，30 秒后允许后续请求重试；冷启动没有缓存则等待加载，失败报错。后台保存不使缓存失效，管理员读写和身份校验仍直接访问数据库。

前端随已登录页面初始化取得公开目录，当前页面不轮询、不因聚焦刷新；独立 `/api/models` 已删除。旧模型或参数被服务端拒绝时提示刷新并重新选择。重新打开页面也可能先取得旧缓存；五分钟不是无请求、多实例或数据库故障时的全局生效时限。用户显式选择的参数优先，未指定时使用模型默认值；失效的旧参数会被拒绝，客户端切换模型时重新解析兼容默认值。

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
node --import tsx e2e/admin/model-catalog-cache.test.mjs
pnpm test:thread-chat:generation-settings
node --import tsx e2e/thread-chat/token-router-wire.test.mjs
node --import tsx e2e/thread-chat/image-attachment-slice.test.mjs
pnpm exec openspec validate add-admin-model-catalog --strict
```

仅在隔离的本地数据库运行有写入的测试：

```bash
ADMIN_CATALOG_TEST_WRITES=1 node --env-file=.env.local --import tsx e2e/admin/model-catalog-db.test.mjs
# 浏览器缓存验收：独立本地 Next 进程与测试脚本共享这个时钟文件。
export ADMIN_CATALOG_TEST_WRITES=1
export ADMIN_TEST_CLOCK_FILE=/tmp/threadchat-admin-test-clock
printf 0 > "$ADMIN_TEST_CLOCK_FILE"
NODE_OPTIONS="--require=$PWD/e2e/admin/server-clock.cjs" pnpm dev
# 在另一终端设置相同的两个环境变量，然后运行：
ADMIN_TEST_CHROMIUM=/path/to/chromium node --env-file=.env.local --import tsx e2e/admin/model-catalog-browser.mjs
```

浏览器测试要求本地 Next 开发服务，`BETTER_AUTH_URL` 对应该地址，`TOKEN_ROUTER_BASE_URL=http://127.0.0.1:55433`，测试会启动模拟中转服务。测试注册专用账号并保留验收数据，不能指向共享开发库。

本次缓存修订已通过类型检查、受影响模块 ESLint、缓存单元/SDK 序列化测试，以及隔离 PGlite 上的实际 Drizzle 读写、初始化幂等、审计、版本冲突、默认模型保护。浏览器使用仅测试进程加载的 `e2e/admin/server-clock.cjs` 推进五分钟时钟，已验证初始化无独立目录请求、后台保存不改变页面与有效缓存、过期首次仍返回旧值、响应结束后 `after` 完成刷新、停用延迟生效及旧页面提示刷新。浏览器完成真实登录、管理员门禁、新增/编辑/默认/停用、手机导航，并验证聊天实际发送新的上游 ID、默认 effort 和 token、工具关闭时不发送 tools，无页面异常。

验收使用 Chromium、PGlite 和模拟上游。测试环境通过本地字体资源替代受限的 Google Fonts 下载，未修改产品字体代码。**这不替代正式 PostgreSQL 迁移/并发锁测试，也不表示真实模型供应商调用或生产部署已验证。**

页面截图：

- [桌面模型目录](screenshots/models-desktop.png)
- [能力与默认值编辑](screenshots/model-editor.png)
- [手机导航](screenshots/models-mobile-navigation.png)
- [聊天配置生效](screenshots/chat-config-applied.png)

- [缓存更新后拒绝旧页面的停用模型](screenshots/stale-model-rejected.png)

## 本次简化的实际范围

删除独立 `/api/models` 接口，移除前端轮询和聚焦刷新。创建、发送、分叉、编辑、重试、更新 Thread 六个命令恢复原同步入口；模型判断保持同步，真实事务与附件读取仍为异步。上述六个命令及内容解析仍需显式传目录，未整文件撤回。新增目录缓存、Next.js 入口及同步查找三个小模块；既有领域测试改为显式传测试目录，新增缓存与生命周期验收。文件数不是本次优化指标，不沿用此前约 68 个文件的估计。

缓存整合补充：同一服务实例通过 globalThis 共用目录，避免页面与接口分别持有模块缓存。冷启动加载失败统一返回 503。未设置 ADMIN_TEST_CLOCK_FILE 时，浏览器脚本等待真实时间；设置时仅加速隔离测试服务的时钟。

本次另已通过真实五分钟 Chromium 验收：过期初始化先返回旧值，Next.js after 完成后再次初始化拿到新值；聊天上游参数从 high/4096 变为 low/8192，旧 high/4096 参数返回 400 和刷新提示，没有目录轮询、聚焦更新或页面异常。分叉引用与 Artifact 内容数据库回归也通过。

[缓存刷新后聊天采用新配置](screenshots/chat-cache-refreshed.png)
