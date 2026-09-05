# 实现与验收记录

基线：`main@490841c1e8598ba34f2c38377f2402ef09861c6a`。实现位于提案原分支，未合并或部署。

## 已落地

- 所有者 Project 顶栏、已完成 Markdown Artifact 详情分享入口；四个期限、默认无限、快照/匿名/正文隐私提示、已有链接与撤销。
- 单表 JSONB 快照；192 位随机 token；一致读取事务；复用 commandId 回执，重放不重读正文或延长期限。
- 公开内容按字段构造并再次按契约序列化。Memory、目标/Instructions、附件信息、provider/tool 内部字段和未知 parts 不公开。
- 保留全部 Thread，以及 forkContext、forkMessageId 和文档来源需要的旧消息；不公开无关旧历史。生成中消息为静态提示，来源未 completed 的文档不可独立分享。
- Markdown AST 处理 HTML、图片、引用链接和自动链接；同时清理代码/纯文本内已知私有及编码地址。阅读渲染器再校验外链，不加载图片。
- 内容与列顺序/折叠/实测宽度/焦点、画布 pins/viewport、已打开 Markdown 面板共同保存。读者操作仅在当前页面内生效，可恢复作者初始布局。
- 公开页面/JSON 使用有效分享查询；不查询私有 Bootstrap、不初始化会话生成运行时。页面动态渲染，设置 no-store、noindex、no-referrer；元信息不包含源内容。
- Source Project 与用户删除时级联移除分享，归档和编辑不更新快照。

实际组件复用：`ThreadColumns`、`ThreadCanvas/useCanvasLayout`、`ConversationMessage`、`AnchoredMarkdown`、`MarkdownBody/ShikiCode` 和 Base UI Dialog。公开画布提供专用阅读插槽，不装配 CanvasActions、Composer 或业务写 callbacks。

上限集中在 `constants/sharing.ts`：请求 128 KiB，快照 8 MiB，500 Thread / 10,000 消息 / 500 文档，单文本 2 Mi 字符；有限布局数值与尺寸。超过上限失败，不静默截断。

## 自动化验证

使用项目声明的 pnpm 10.32.1 安装依赖。未运行任何 format 命令。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` 对应的 `tsc --noEmit` | 通过；本次也用 `next typegen` 同步路由类型 |
| `pnpm test:thread-chat:sharing` | 9 项通过 |
| `pnpm test:thread-chat:sharing-db` | 8 项通过（含子项） |
| 同一数据库套件在 PostgreSQL 17 + pgvector 上运行 | 12 项通过，包含多连接竞争；[CI 记录](https://github.com/hifizz/thread-chatbot/actions/runs/33985730994) |
| `pnpm test:thread-chat:sharing-http` | 4 项通过，真实生产 Next 服务 + PostgreSQL；匿名和已登录 JSON/HTML/RSC、元信息、撤销/到期、私有接口权限 |
| `pnpm test:thread-chat:sharing-dialog` | 5 项通过；React DOM + jsdom 的真实组件交互，未替换弹窗或文档面板 |
| 私有工作台回归：normalized-client-store、canvas-expand-ownership、canvas-layout-cache、project-panel-workspace-state、message-action-presentation | 7 项通过 |
| 全仓库 ESLint | 0 error；2 条基线 warning，位于 app/layout.tsx、lib/auth/session-recovery.ts |
| `pnpm build` | 清理临时验收页面的生成缓存后通过；最终产物仅保留动态 `/share/[token]` 分享页面 |
| OpenSpec 严格校验 | 本变更通过；全仓库 32 项通过、0 失败 |

数据库测试使用全新进程内 PGlite（PostgreSQL WASM）和 pgvector，通过 Drizzle `pushSchema` API 应用真实 schema 源码，再使用 Node 模块 mock 将数据库适配器注入实际 application / route handler。没有 mock SQL、所有权判断、事务业务或登录函数；HTTP handler 测试使用 better-auth 实际注册/会话 cookie。测试不读取外部 DATABASE_URL。

覆盖：跨用户拒绝、伪造 bearer token 不授权管理、严格请求/Origin 校验、四种期限及截止边界、重放与冲突命令、创建失败事务回滚、快照不随修改/归档变化、独立文档范围、撤销幂等、Project/用户删除级联。

本地原生 PostgreSQL 仍受运行用户权限限制；新增 `.github/workflows/snapshot-sharing.yml` 在 GitHub 独立 PostgreSQL 17 + pgvector 服务中完成真实多连接联调。测试通过锁等待协调不同连接，验证两次读取之间修改源数据仍得到同一可见时点、相同 commandId 竞争后的 40001 错误可重试且只有一个结果、读取期间删除 Project 不留下快照或命令回执。

外部数据库测试只接受显式 `SNAPSHOT_SHARING_TEST_DATABASE_URL`，数据库名必须以 `snapshot_sharing_` 开头且初始为空；不会重置已有库。CI 不读取生产秘密，只在空库应用 schema 源码，未创建、修改或删除任何 `drizzle/` 文件。这仍不代替上一版本数据库升级验收。

HTTP 套件启动真实 `next start`，使用真实注册/会话请求创建分享。对匿名和所有者分别检查 JSON、HTML、RSC；跟随 Next 的 RSC 参数校验重定向后确认组件流类型，避免把重定向响应误算成 RSC 验收。先读取、再撤销或到期，重复读取时正文均不可用；元信息恒定，私有 Project/Message/Artifact、附件和业务写接口均拒绝仅持 token 的请求。本地套件也通过 PGlite Socket 运行，CI 使用原生 PostgreSQL。

本轮修复：分享管理接口的 Origin 检查使用 `BETTER_AUTH_URL` 配置的公开站点地址，避免反向代理后的内部 Next 地址误拒绝合法请求；伪造 forwarded-host 仍不能扩大来源范围。弹窗开始下一次创建时清除上次的“新分享链接”，失败时保留旧链接的管理列表但不把它展示为本次成功结果。

## 浏览器检查

使用人工多层分支样本，临时页面直接装配真实 ShareReader / ShareDialog。临时页面在验收后删除，不进入提交或最终构建。样本没有用户数据。

- 桌面首屏：根 Thread、打开的深层分支、折叠的中间分支及文档面板正确显示。
- 画布：实际 DOM transform 为 `translate(40px, 60px) scale(0.75)`，与快照一致；2 个固定节点保留；节点展开为只读正文。
- 来源弹窗：完整 Markdown、代码、表格和分支脚注可读；匿名 DOM 不包含秘密哨兵。
- 恢复布局后，选择项回到 `deep/document`，列顺序回到 `main/deep/branch`，branch 再次折叠。
- 390px 窄屏 iframe：文档可阅读、关闭后可切换全部分支，保留选择焦点。
- 独立文档：无 Project/Thread 下拉导航或私有来源链接。
- 页面无 textarea、contenteditable 和自动加载的 img；安全资料链接保留。
- 弹窗：默认无限，3/7/30 天选项及隐私提示完整；匿名失败请求显示“请先登录”，没有成功链接，支持沿用请求重试。

上述浏览器证据来自首轮测试样本阅读验收，**不是所有者创建 → 数据库 → 匿名打开的完整浏览器端到端验收**。本轮完成了真实 HTTP 链路与 React DOM 交互测试，但没有将它们算作真实浏览器覆盖。组件测试验证了四种期限、连续点击只提交一次、失败不显示旧成功链接、重试沿用请求、撤销与复制失败提示，以及实际文档面板仅向 completed Markdown 展示分享入口。

本轮隔离预览先遇到测试样本 ID 映射错误，修正后遇到自定义测试服务器的 Next AsyncLocalStorage 启动错误。按 `sites-preview-troubleshooting` 技能最多两次启动的限制停止尝试；已删除临时预览服务器，恢复正常 dev 命令，移除仅用于该预览的新增依赖。未改动生产登录门禁。完整浏览器脚本 `e2e/thread-chat/verify-snapshot-sharing.mjs` 仍未运行。

开发预览修复仅有：`scripts/dev.sh` 将预览参数映射到 Next CLI，`next.config.ts` 为开发资源允许精确的本地预览 origin。两项不改变生产路由鉴权。

## 仍待完成的验收与发布门槛

- 6.6、7.1：在可用的真实浏览器集成环境中完成所有者 UI 创建到匿名阅读的流程、已登录所有者只读交互、网络无业务写请求及私有 workspace 缓存不污染，并逐项完成全部规格场景。
- 8.1：由明确的 develop 集成任务生成 migration、审查 SQL，并在上一版本数据库验证升级。
- 8.2：升级数据库并部署，执行匿名/期限/撤销/私有权限 smoke；回滚时关闭分享入口及公开路由，保留原会话数据和新增表。

当前 31/35 项完成，保留上述 4 项任务未勾选，不将这次实现视为可直接发布。公开内容一旦已经加载或复制，不承诺远程收回；链接处理不等于语义脱敏。

## 集成浏览器脚本

在隔离集成环境中，用样本创建 Project、独立 Markdown 分享，设置以下环境变量后运行：

```sh
SNAPSHOT_PROJECT_SHARE_URL=... \
SNAPSHOT_ARTIFACT_SHARE_URL=... \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... \
node e2e/thread-chat/verify-snapshot-sharing.mjs
```

可另传 `SNAPSHOT_OWNER_STORAGE_STATE` 以重复验证已登录所有者阅读。脚本只进行读取和本地阅读布局操作，不创建/删除业务数据，不打印分享 token。生产环境不要使用测试样本或测试凭据。
