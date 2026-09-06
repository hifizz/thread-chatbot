## Why

ThreadChat 的网状对话与 Markdown 成果需要可匿名阅读的分享入口，才能用于对外宣传、成果展示和交流。分享者需要固定精心安排的首屏与内容，避免继续在原 Project 中工作时自动公开新内容，同时保持私有资料和内部指令的权限边界。

## What Changes

- 一期新增 Project 与 Markdown Artifact 两种分享入口；长期支持 Project、Thread、Message、Artifact 四种粒度，但本期不实现 Thread 或 Message 独立分享。
- 采用创建时冻结的内容快照：服务端从所有者的数据生成公开白名单内容并持久化；原内容后续新增、编辑或重新生成不改变旧快照，更新分享需创建新链接，不做实时同步或内容版本管理。
- Project 快照覆盖所有 Thread、阅读所需的消息与来源关系、已完成来源的 Markdown Artifact；访问者可自由打开分支、切换列/画布、浏览引用与产物，不能修改原数据或快照。
- 同时保存当前首屏布局，包括视图模式、打开的 Thread 及顺序、折叠、列宽、焦点、画布位置/视口和当前 Artifact。移动端保留内容顺序和焦点并适配屏幕；访客浏览不覆盖分享者布局。
- 提供匿名链接与有效期 `3 天 / 7 天 / 30 天 / 无限`，默认无限，从服务端创建时间计算；支持所有者查看已有分享、复制链接和撤销。到期或撤销后服务端拒绝新的内容请求。
- 独立 Artifact 分享只公开该 Markdown 产物，不连带授权来源 Project、Thread 或 Message。
- 快照和公开响应均排除 Project Memory、Instructions、Contract 内部配置、原始附件/Project Files、私有下载地址、账号信息及内部运行数据；消息 parts、Markdown 链接与关联信息同样执行白名单处理，不能仅在 UI 隐藏。
- 分享弹窗明确提示快照不随原内容更新、持链接者可阅读、有效期及敏感正文需自行检查；不承诺撤回访客已经复制的内容。
- 增加公开路由及仅限快照的读取路径，不放宽既有私有页面、写接口、附件接口的所有权校验。

## Capabilities

### New Capabilities

- `snapshot-sharing`: 定义 Project/Markdown Artifact 冻结分享、匿名访问、有效期与撤销、首屏布局、只读阅读、隐私白名单和验收行为。

### Modified Capabilities

无。现有 `openspec/specs/` 尚无分享能力；本期不改变 Thread/Fork 的领域语义、私有工作台权限或 Markdown 的常规排版规范。

## Impact

- 基线：`main`，提交 `490841c1e8598ba34f2c38377f2402ef09861c6a`；以当前规范化 Project/Thread/Message/Artifact 实现为准，不采用旧整树持久化说明。
- 数据库与服务端：新增分享记录和 JSONB 快照、所有者管理命令、公开读取与数据筛选；保持原会话实体不变，不新增 Snapshot Worker、厂商适配器或权限框架。
- 路由：新增 `/share/[token]` 与对应公开读取接口，精确调整 `proxy.ts` 的公开页面匹配；现有 `/thread-chat` 服务端登录门禁及私有 API 保持不变。
- 前端：Project 顶栏/Markdown Artifact 详情的分享入口与弹窗，复用阅读与布局组件，隔离会话生成运行时、本地工作台持久化和写命令。
- 验证：补充快照稳定性、有效期边界、跨用户授权、隐藏字段/附件泄露、分支历史完整性、布局恢复及匿名浏览器只读测试。
- 交付边界：本 change 当前仅提出方案与未完成任务，不修改业务代码或数据库。后续功能分支只改 schema 源码，迁移按项目规则由 `develop` 集成任务统一生成验证，未验证前不视为可发布。
- 非目标：实时分享、快照更新/版本历史、Thread/Message 单独分享、任意内容隐藏/打码/自动脱敏、附件公开、密码/邀请协作/访问统计、HTML Artifact 或 Custom Visual 分享。
