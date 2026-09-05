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
| 私有工作台回归：normalized-client-store、canvas-expand-ownership、canvas-layout-cache、project-panel-workspace-state、message-action-presentation | 7 项通过 |
| 全仓库 ESLint | 0 error；2 条基线 warning，位于 app/layout.tsx、lib/auth/session-recovery.ts |
| `pnpm build` | 清理临时验收页面的生成缓存后通过；最终产物仅保留动态 `/share/[token]` 分享页面 |
| OpenSpec 严格校验 | 本变更通过；全仓库 32 项通过、0 失败 |

数据库测试使用全新进程内 PGlite（PostgreSQL WASM）和 pgvector，通过 Drizzle `pushSchema` API 应用真实 schema 源码，再使用 Node 模块 mock 将数据库适配器注入实际 application / route handler。没有 mock SQL、所有权判断、事务业务或登录函数；HTTP handler 测试使用 better-auth 实际注册/会话 cookie。测试不读取外部 DATABASE_URL。

覆盖：跨用户拒绝、伪造 bearer token 不授权管理、严格请求/Origin 校验、四种期限及截止边界、重放与冲突命令、创建失败事务回滚、快照不随修改/归档变化、独立文档范围、撤销幂等、Project/用户删除级联。

原生 PostgreSQL 服务在本环境受非 root 运行及进程连接限制，未能完成普通 PostgreSQL 的独立多连接联调。PGlite 是单连接测试库，不能代替竞争条件和生产数据库升级验收。未创建、修改或删除任何 `drizzle/` 文件。

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

浏览器使用测试样本进行阅读组件验收，**不是所有者创建 → 真实数据库 → 匿名打开的完整端到端验收**。也未宣称完成所有网络/缓存组合和已登录所有者的浏览器覆盖。完整验收脚本 `e2e/thread-chat/verify-snapshot-sharing.mjs` 已提供，但该脚本本轮未运行。

开发预览修复仅有：`scripts/dev.sh` 将预览参数映射到 Next CLI，`next.config.ts` 为开发资源允许精确的本地预览 origin。两项不改变生产路由鉴权。

## 仍待完成的验收与发布门槛

- 3.5：在真实多连接 PostgreSQL 验证创建期间源内容修改/删除、并发同 commandId 的竞争与重试。
- 4.4、6.6、7.1、7.3：实际部署运行时中验证匿名及已登录所有者的 JSON/HTML/RSC/metadata、到期/撤销、网络无写请求、私有 workspace 缓存不污染，以及全部规格场景。
- 5.4：完整所有者 UI 创建/复制/撤销与失败重试、非 Markdown/未完成文档入口，以及私有工作台浏览器回归。
- 8.1：由明确的 develop 集成任务生成 migration、审查 SQL，并在上一版本数据库验证升级。
- 8.2：升级数据库并部署，执行匿名/期限/撤销/私有权限 smoke；回滚时关闭分享入口及公开路由，保留原会话数据和新增表。

因此保留 8 项任务未勾选，不将这次实现视为可直接发布。公开内容一旦已经加载或复制，不承诺远程收回；链接处理不等于语义脱敏。

## 集成浏览器脚本

在隔离集成环境中，用样本创建 Project、独立 Markdown 分享，设置以下环境变量后运行：

```sh
SNAPSHOT_PROJECT_SHARE_URL=... \
SNAPSHOT_ARTIFACT_SHARE_URL=... \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=... \
node e2e/thread-chat/verify-snapshot-sharing.mjs
```

可另传 `SNAPSHOT_OWNER_STORAGE_STATE` 以重复验证已登录所有者阅读。脚本只进行读取和本地阅读布局操作，不创建/删除业务数据，不打印分享 token。生产环境不要使用测试样本或测试凭据。
