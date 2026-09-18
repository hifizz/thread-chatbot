# add-snapshot-sharing

## Why

ThreadChat 的网状对话与项目文档需要可匿名阅读的分享入口，用于对外宣传、成果展示和交流。分享者需要固定精心安排的首屏与内容，避免继续在原 Project 中工作时自动公开新内容，同时保持私有资料和内部指令的权限边界。

本提案基于当前规范化模型刷新早期方案：现在 Markdown 产物挂在 `documents`/`document_revisions` 持续文档身份下，分享粒度按用户心智对象对齐为 **Project 整站** 与 **文档当前版本** 两种。

## What Changes

- 一期提供 Project 与 Document 两种分享入口；不实现 Thread 或 Message 独立分享。
- 采用创建时冻结的内容快照：服务端从所有者数据生成公开白名单内容并持久化；原内容后续新增、编辑、重命名、重新生成或文档提交新版本，均不改变旧快照。更新分享需创建新链接，不做实时同步或版本管理。
- Project 快照覆盖全部 Thread、阅读闭包所需消息（当前时间线 ∪ forkContext/forkMessageId 来源 ∪ Artifact/Document 来源链）、全部已完成 Artifact 正文、Document 目录及其"分享时当前版本"映射、初始布局。访问者可自由打开分支、切换列/画布、浏览引用与产物，不能修改任何数据。
- Document 分享冻结"创建时的当前版本"（pin revisionId → artifactId），只公开标题、正文与产物时间，不连带来源对话、版本导航或 Project 授权。
- 同时保存首屏布局：view、列顺序/折叠/宽度/焦点、画布 pins/viewport、打开的 Artifact/面板。移动端保留内容顺序和焦点并适配屏幕；访客浏览不覆盖分享者布局。
- 匿名链接有效期 `3 天 / 7 天 / 30 天 / 无限`，默认无限，从服务端创建时间计算；支持所有者查看已有分享、复制链接和撤销。到期或撤销后服务端拒绝新的内容请求。
- 快照和公开响应均排除 Project target/instructions、feedback、providerUsage、documentContextUsed、内部错误、附件/R2/签名地址、账号计费调试数据；消息 parts 按类型白名单裁决（含研究轨迹、文档工具、`documentToolParts` 合并结果），未知 part 默认排除，不能仅在 UI 隐藏。
- 分享弹窗明确提示快照不随原内容更新、持链接者可阅读、有效期及敏感正文需自行检查；不承诺撤回访客已经复制的内容。
- 增加公开路由 `/share/{token}` 及仅限快照的读取路径，不放宽既有私有页面、写接口、附件接口的所有权校验。

## Capabilities

### New Capabilities

- `snapshot-sharing`：Project/Document 冻结分享、匿名访问、有效期与撤销、首屏布局、只读阅读、隐私白名单和验收行为。

### Modified Capabilities

无。本期不改变 Thread/Fork/Document 的领域语义、私有工作台权限或 Markdown 排版规范。

## Impact

- 基线：`main`（撰写时 `a66113f`）；以当前规范化 Project/Thread/Message/Artifact/Document 实现为准。
- 数据库与服务端：新增 `shares` 表（token 唯一、ownerId/sourceProjectId 级联外键、snapshot JSONB、生命周期字段）、所有者管理命令、公开读取与白名单序列化；不新增 Snapshot Worker、厂商适配器或权限框架。
- 路由：新增 `/share/[token]` 页面与 `GET /api/share/{token}`；`proxy.ts` 的 publicPages 精确匹配需增加 `/share/` 前缀放行；现有 `/thread-chat` 登录门禁及私有 API 不变。
- 前端：Project 顶栏与 Document/Artifact 详情的分享入口与弹窗；只读阅读壳复用 `ConversationStore` hydration + workspace/overlay hooks + 消息/画布/Markdown 阅读组件，不装配 runtime/commands。
- 验证：按 `e2e/**/*.test.mjs` 惯例补充快照闭包/白名单/链接清洗纯函数测试、DB 事务与幂等测试、playwright 匿名只读验收。
- 交付边界：功能分支只改 schema 源码并对独立本地库 `db:push`，迁移按项目规则由 `develop` 集成任务统一生成验证，未验证前不视为可发布。
- 非目标：实时分享、快照更新/版本历史、Thread/Message 单独分享、指定历史版本分享、正文自动脱敏/打码、附件公开、密码/邀请协作/访问统计、HTML Artifact 或 Custom Visual 分享、文档版本导航。
