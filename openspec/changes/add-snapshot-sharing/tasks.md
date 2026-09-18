# add-snapshot-sharing — 任务

## 1. 契约与常量

- [x] 1.1 `constants/sharing.ts`：有效期枚举（3/7/30天/无限，默认无限）、token 格式、宽松上限（snapshot ≤16MB、messages ≤5000、layout ≤512KB）、提示文案
- [x] 1.2 `lib/thread-chat/sharing/contracts.ts`：创建命令判别联合（project/document）、`PublicProjectSnapshot`/`PublicDocumentSnapshot`、`ShareDTO` zod schema；严格拒绝正文/owner/token/自定义期限
- [x] 1.3 测试：枚举与边界值、未知字段拒绝

## 2. 快照构造与白名单（纯函数）

- [x] 2.1 `snapshot.ts`：Project 闭包选取——全部 Thread + 当前消息 ∪ forkContext/forkMessageId 来源 ∪ Artifact/Document 来源链；同 Project 校验，跨 Project/缺失引用失败
- [x] 2.2 `snapshot.ts`：全部 Artifact（含 content）+ Document 目录 pin 当前版本；生成中/stopped/failed 消息静态化
- [x] 2.3 `whitelist.ts`：字段级剔除（instructions/target/feedback/error/providerUsage/documentContextUsed/modelId/标题内部态）+ parts 逐类型裁决表（含 research 三件套、文档工具折叠、readUrl 丢 content、updates/notices 剔除、file→占位）
- [x] 2.4 `sanitize-links.ts`：Markdown AST 清洗 `/api/attachments/*`、R2/签名地址、危险协议；覆盖 inline/reference/autolink/image/纯文本；外链 noreferrer 标记
- [x] 2.5 `layout.ts`：布局白名单规范化——ID 属于快照、数值有限有界、失效引用安全回退
- [x] 2.6 测试：分支闭包/无关旧消息不公开/跨项目失败/未知 part 默认排除/哨兵值不出现在快照 JSON

## 3. 持久化与所有者命令

- [x] 3.1 `lib/db/schema.ts` 加 `shares` 表（token 唯一、ownerId/sourceProjectId 级联、类型/时间约束、管理索引）；仅本地库 `db:push`，不动 `drizzle/`
- [x] 3.2 `persistence/share-repository.ts`：REPEATABLE READ 创建事务（所有权→闭包→白名单→expiresAt→原子写）、按 token 查有效分享、按资源列表、幂等撤销
- [x] 3.3 `application/sharing.ts`：`createShare`（接 `conversationCommands` 幂等）/`listShares`/`revokeShare`/`getPublicShare`
- [x] 3.4 测试：跨用户拒绝、幂等重放与冲突、各期限与边界、重复撤销、级联失效、归档不改快照

## 4. 路由与公开访问面

- [x] 4.1 `server/handlers.ts` +4 handler：`handleCreateShare`/`handleListShares`/`handleRevokeShare`（`withThreadChatRoute`）、`handleGetPublicShare`（无 auth，`jsonNoCache`，统一不可用响应）
- [x] 4.2 路由：`POST/GET /api/thread-chat/v1/shares`、`DELETE /api/thread-chat/v1/shares/[shareId]`、`GET /api/share/[token]`
- [ ] 4.3 `app/share/[token]/page.tsx`：`force-dynamic` + noindex + no-referrer；RSC 共用有效性检查后渲染只读壳
- [ ] 4.4 `proxy.ts`：`/share/` 前缀放行，其余精确匹配不变
- [ ] 4.5 测试：匿名读取、无效/过期/撤销统一 404、token 不授予私有访问、无私有路径误放行

## 5. 所有者入口与布局捕获

- [ ] 5.1 `orchestration/sharing/share-dialog.tsx`：四期限/默认无限/创建/复制/已有列表/撤销/提示文案；键盘与移动端可用
- [ ] 5.2 `orchestration/sharing/capture-layout.ts`：确认时读 `store.getState().workspace` + overlay（activeArtifactId/drawerOpen），剔除 recents/草稿/模型设置
- [ ] 5.3 入口：Project 顶栏分享按钮；Document/Artifact 详情头部入口（凭 `ArtifactSummaryDTO.document` 判定可分享性）；删除 Project 确认文案提示关联分享失效
- [ ] 5.4 测试：创建失败不显示链接、重复提交不重复创建、非 Document Artifact 不可分享

## 6. 分享页（复用同一组件树 + ShareRuntime）

- [ ] 6.1 `useShareRuntime(token)`：fetch `/api/share/{token}` → `createConversationStore({workspace: snapshot.layout})` + `hydrateProject(snapshot)`；复用页面 loading/ready 状态机
- [ ] 6.2 `readOnly` 状态位贯穿组件树：Composer、消息操作、Fork/Retry/Edit/Stop、反馈、重命名、上传、文档更新入口呈禁用态或省略；导航/折叠/拖动/缩放/复制照常
- [ ] 6.3 stub commands 兜底：与 `createConversationCommands` 同接口，写方法不发起任何请求；含 `dispose()`
- [ ] 6.4 `/share/[token]` 页挂 `NormalizedThreadChat`：不调用 `bootConversationProject`；`treeId` 作用域 key 改 `share:{token}` 命名空间；左侧项目列表与 AccountButton 隐藏/替换为"只读快照"徽标
- [ ] 6.5 布局恢复：列/折叠/宽度/焦点、画布 pins/viewport（不被首次 fitView 覆盖）、Artifact 面板；读者操作仅本地，重开恢复初始
- [ ] 6.6 Document 阅读页：复用 MarkdownBody + 安全链接策略，无私来源入口，不自动加载图片/附件
- [ ] 6.7 移动端适配：压缩列数保顺序/焦点，全 Thread 可达；沿用 `.tc` token 与表格局部滚动
- [ ] 6.8 测试：hydrate 正常渲染、快照外 ID 不可达、写控件禁用态、无私有/写网络请求

## 7. 联合验收

- [ ] 7.1 验收样本：多层分支 + 父来源已替换 + 文档当前版 + 附件哨兵 + 未完成消息 + 手动布局，逐条覆盖 spec 场景
- [ ] 7.2 不可变性：创建后新增/编辑/重命名/重生成/文档新版本/改布局均不影响旧链接
- [ ] 7.3 playwright 匿名验收：首次加载/刷新/JSON/HTML/RSC 的缓存与隐私边界；已登录所有者打开同样只读
- [ ] 7.4 `pnpm typecheck` 每批必跑；模块完成后查重复常量/逻辑；最终 lint + e2e + `pnpm openspec:validate --strict`

## 8. 发布门槛（不在功能分支生成 migration）

- [ ] 8.1 `develop` 集成任务统一 `db:generate` + 审查 SQL + 上一版结构库 `db:migrate` 验证
- [ ] 8.2 部署后 smoke：匿名分享、期限/撤销、私有权限；确认关闭 `/share/*` 的回滚路径可用
