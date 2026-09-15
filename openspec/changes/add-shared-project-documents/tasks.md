本 Change 已开始实施；勾选表示对应代码或本地验证完成。2026-09-15 已完成原生 PostgreSQL 验证及部分真实模型、EGO 浏览器验收，未覆盖项仍保持未勾选，详见 implementation.md。不修改 #143 的完成状态，不在功能分支生成数据库迁移。

## 1. 依赖与合同

- [x] 1.1 核对 #143 的实现/归档状态以及固定 Artifact、Quote 删除、forkContext、旧请求兼容合同，确认本期不扩大新建 Fork 的 completed 来源资格。
- [x] 1.2 定义 Document/Revision/read/update DTO、错误联合、readId 收据及固定上下文 Part；模型输入与服务端可信执行身份分开，文案/限制/工具名集中到 constants。
- [x] 1.3 实现 Markdown patch 纯函数，覆盖原文唯一匹配、重复文本、重叠、倒序应用、空 newText、追加、方案加勾选同次修改、大小限制及 no-op。

## 2. 数据与版本仓储

- [x] 2.1 在 Schema 源码增加 documents/document_revisions，验证同文档 parent/head、唯一 artifactId/版本号、来源关系和项目隔离；在独立数据库 db:push，不生成 drizzle 文件。
- [x] 2.2 实现 Document current/历史/差异/版本列表查询，正文只从固定 Artifact 读取；增加按 Artifact 精确解析 Document 的查询。
- [x] 2.3 接通普通 Markdown 创建的原子 Document/R1 登记与更新产物的去重路径；验证提交不得留下 currentRevisionId 空的可见文档。
- [x] 2.4 编写可恢复、幂等的旧 completed Markdown 登记过程，保留旧 Artifact ID，不按同名合并；验证重复运行、部分失败、未登记不可写及原引用回放。

## 3. 文档更新应用服务

- [x] 3.1 实现统一 updateDocument 服务：所有权校验、文档行锁、幂等回放、可写/执行状态检查、expectedRevisionId 和 readId 验证、原子 Artifact/Revision/head/收据提交。
- [x] 3.2 通过真实并发事务验证 A/B 同版本修改：仅一个提交成功、另一个版本冲突；不同文档独立更新，统一锁顺序，持锁期间不调用模型。
- [x] 3.3 实现结构化冲突/拒绝/no-op 结果与请求校验，覆盖整笔失败无副作用、超限、文档归档、ID 重用不同 payload 及成功后 head 前进仍回放原收据。
- [x] 3.4 校验 Stop 与提交的先后协调，保证停止先发生不写入、提交先成功不撤销；最终化/恢复不重复收集或删除已提交 Artifact。

## 4. 自然语言工具

- [x] 4.1 注册 findProjectDocuments/readProjectDocument/updateProjectDocument，复用生成计划和应用服务，服务端绑定用户、Project、Thread、Message、执行及命令身份。
- [x] 4.2 实现精确 @artifact→Document 解析、名称候选返回和明确目标后的读取，覆盖同名、缺失、跨 Project、文档正文伪造操作指令等输入。
- [x] 4.3 持久化完整读取结果与 readId，验证其执行/文档/版本匹配，禁止历史引用或只换 expectedRevisionId 绕过重读。
- [x] 4.4 配置 read→update→冲突重读→新提交→说明的工具循环，默认每文档每执行最多 2 次自动冲突重试；新 patch 新命令，网络重试沿用原命令。
- [x] 4.5 建立自然语言验收样例：更新 TODO6 方案加复选框；已删除目标不恢复；文本仍在但前提变化；已经满足不重复写；仅讨论不修改；成功提示依据真实收据。

## 5. 后台通知与模型上下文（取代旧接收方案）

- [x] 5.1 所有 Thread 的 send/edit/fork firstTurn 使用同一快照通知入口，固定摘要身份/来源与省略数量，不自动读全文。
- [x] 5.2 新通知确定性编译并保留历史，显式读取追加固定结果；旧全文格式兼容，摘要不作为全文去重依据。
- [x] 5.3 按 Thread 保存有效响应通知收据，使用版本号游标；失败/仅浏览不推进，不与 readId 混淆。
- [x] 5.4 测试重试固定、接受后新版、跨 Thread 独立、分叉首轮、失败历史与模型消息前缀稳定。
- [ ] 5.5 在 macOS 用真实模型验收按需读取、连续更新、相关/无关文档和预算超限；unknown 不伪称通过。

## 6. 客户端与来源衔接

- [x] 6.1 扩展客户端 DTO/store/client 与 ProjectPanel，按 Document 显示一份文件，DocumentView 管理当前/历史版本并复用 ArtifactDetail/MarkdownBody。
- [x] 6.2 增加 DocumentVersionHistory/DocumentDiff，只读显示版本、真实差异和来源；使用现有 diff 库及组件，不在组件中应用修改。
- [x] 6.3 接通 DocumentUpdateTool 的读取、提交、冲突重读、已提交、unchanged 和失败状态，刷新从持久化收据恢复，模型文字不作为提交依据。
- [x] 6.4 移除 ProjectDocumentUpdates、documentScope 和范围按钮，提取目录同步 Hook，保留历史版本/选区/草稿。
- [x] 6.5 复用 #143 的固定版本划选及导航：最新版来源在哪个 Thread 就从哪里分叉，活跃选区/草稿不追新 head；来源未 completed 时清楚说明不可新分叉。
- [ ] 6.6 验证导出与分享在创建时固定版本，旧分享不追最新内容，公开入口无写入；手机复用 Drawer、焦点与主题组件。

## 7. 验收与发布

- [ ] 7.1 运行真实数据库/API 测试：原子 edits、并发 CAS、幂等、隔离、Stop、归档、恢复、迁移登记和项目整体删除；每批功能代码后运行 pnpm typecheck。
- [ ] 7.2 核对最终模型请求及工具执行序列：最新读取、readId、重试预算、删除目标、语义前提变化、两处修改一次提交、后台摘要、按需读取与上下文预算。
- [ ] 7.3 桌面与手机浏览器完成 F1 主线创建→A/B 更新冲突→查看历史/差异→主线继续聊自动通知→旧引用/分享回放流程，并保存验收截图与失败恢复证据。
- [x] 7.4 运行 OpenSpec 严格校验及必要的现有回归，按真实完成情况更新 tasks；不手工运行 format，不将未验收功能视为可发布。
- [ ] 7.5 develop 单一集成任务生成并验证 additive migration，旧库升级/可恢复登记通过后按数据库→兼容服务端→工具/客户端顺序发布。
- [ ] 7.6 验证关闭写入仍可读取固定版本及恢复收据的回退方案；功能验收后按依赖顺序 archive/sync Spec。

## 8. 本次行为变更复验

- [ ] 8.1 macOS EGO 确认桌面/手机无待接收按钮、无通知分隔线；目录更新、历史导航、草稿保护仍正常。
- [ ] 8.2 macOS 原生独立 PostgreSQL 运行更新后的数据库测试，真实模型执行后台摘要→按需读取→原子更新。
