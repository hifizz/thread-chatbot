# macOS 本地验收

目标：在真实模型和本机 PostgreSQL 上验收「主线创建 F1 → A/B 更新 → 固定历史 → 主线继续」。本轮不使用 Neon，也不部署。功能分支只有 Schema 源码；正式迁移仍由 develop 集成任务生成。

## 1. 准备

使用 Node 22.15+ 或 24、pnpm 10.32.1，以及本机 OrbStack/PostgreSQL。建议创建独立 worktree，避免 rebase 后覆盖你已有的本地修改：

```bash
git fetch origin docs/shared-project-documents
git worktree add ../thread-chat-documents-acceptance -b local/documents-acceptance FETCH_HEAD
cd ../thread-chat-documents-acceptance
pnpm install --frozen-lockfile
```

将本机开发配置复制到此 worktree 的 `.env.local`，把 DATABASE_URL 改成**独立的本机数据库**：数据库名使用 `wt_*` 或 `thread-chat-documents-test`。先创建该空库。DIRECT_URL 如有配置，也必须指向同一独立库。保留你的 Token Router 和登录配置，不能使用日常或线上数据库。

```bash
pnpm db:push
pnpm worktree:seed
pnpm typecheck
pnpm test:thread-chat:documents
pnpm test:thread-chat:documents-db
pnpm documents:backfill
pnpm documents:backfill
pnpm dev
```

数据库检查只允许本机独立库。它调用真实应用服务，创建独立测试用户/项目并清理；不会调用模型。原生模式必须输出「观察到 A/B 两条连接同时等待文档锁」，再验证恰好一个成功、一个冲突。未输出这条或出现异常，不能把并发门槛记为通过。

旧文档登记第二次应新增 0 项。要验证有历史数据的升级，需要另准备旧数据副本，不能拿空库结果代替旧库升级。不要在本分支运行 db:generate。

## 2. 核心操作

| 步骤 | 用户操作 | 通过标准 |
| --- | --- | --- |
| 创建 | 主线要求创建 F1，包含 TODO6、方案「旧方案」、未完成复选框，以及 TODO2 | 项目中只有一份 F1，初始 V1 |
| 分叉 | 从 F1 划选 TODO6，开启 A；从另一段开启 B | 分叉引用固定原文，可返回来源 |
| 自然语言更新 | A 发送「帮我更新 @F1，把 TODO6 的方案改成 xx，并勾选为已完成」；@F1 从真实提及候选选择 | 工具读取最新版，方案与复选框同一版本保存，出现真实已保存卡片 |
| B 更新 | B 更新 TODO2；与 A 同时发起可观察冲突，但不保证模型时序必然重合 | 保留 A 的修改；发生冲突则重读、重新提交，不能覆盖旧版 |
| 历史 | Dropdown 切换 V1 和新版本，查看差异 | V1 原文不变，差异包含两处修改；切换不回滚 head |
| 活跃选区 | 保持 V1 划选/提问草稿，在另一浏览器窗口更新 F1 | 显示有新版，原正文和草稿不被替换 |
| 版本来源 | 从 A 提交的版本划选开 C | C 父节点是 A，引用返回 A 产生的固定版本 |
| 后台通知 | A 更新后回主线发送「TODO6 现在什么方案」 | 无接收按钮/通知分隔线；用户消息后台存摘要，AI 按需读取最新版后回答；有效响应后记录该 Thread 通知收据 |
| 分支通知 | B 继续询问 A 刚更新的内容；另有无关文档也被更新 | B 独立收到摘要，按需读取相关全文；不自动读所有文档，不带入 A 的整段讨论 |
| 导出/分享 | 选择 V1，导出，或使用系统文件分享，然后继续更新 F1 | 文件仍是 V1 原文；浏览器不支持文件分享时明确提示先导出。本期没有公开分享链接 |

## 3. 失败和边界

- 在另一分支删除 TODO6，再要求更新：不得擅自恢复，不得修改 TODO2。
- 创建第二份同名 F1，只按名称要求更新：应询问目标；真实 @artifact 必须精确解析。
- 只问「F1 的方案有什么问题」：可以读取，不能产生新版本。
- 再次要求相同的方案和完成状态：说明已满足，不创建重复版本。
- 提交成功卡片出现后 Stop 或刷新：版本仍保留，工具收据能够恢复。
- 来源回复仍生成中/已失败时，已提交文档仍可读取，但不能从该回复开启新分支。
- 历史引用、选区 Quote 删除后不能自动恢复；旧 @F1 仍显示旧文，但明确更新该文件时须先读取最新版本。
- 提供商拒绝上下文超限：不记录通知收据；新消息仍可获知变化，重试固定原通知。历史新格式摘要和实际读取结果不删除。提示不能再要求去面板选择范围。计量仍为 unknown，不拿字符数冒充 token。
- 将 `THREAD_CHAT_DOCUMENT_WRITES=false` 写入本地配置并重启：新写工具停用，读取和成功收据恢复仍可用。测完恢复配置。

自然语言样例另见 `e2e/thread-chat/document-update-cases.json`。至少在桌面和手机尺寸各走一次主流程，保存版本、差异、来源导航、刷新恢复截图；记录浏览器、模型 ID、提交号和失败现象。

## 4. 验收记录

| 门槛 | 状态 / 证据 |
| --- | --- |
| macOS 类型与纯函数检查 | 通过，见本轮修复验收记录 |
| 原生 PostgreSQL 双连接锁竞争 | 通过，实际观察双连接等待；不同文档独立提交通过 |
| 旧文档登记/中断恢复 | 待本地历史数据验证 |
| TODO6 真实模型工具序列 | 主线精确 @artifact 更新通过；A/B 分支与完整边界仍待验收 |
| 桌面与手机交互 | 部分通过：版本、差异、导出及手机展示；完整矩阵未通过 |
| develop migration 与旧库升级 | 独立集成任务，不在此分支执行 |

验收完成后更新 tasks，再按依赖顺序归档 Spec；不能把这份清单的存在当作已验收。

2026-09-15 证据见 [代码质量修复验收](../../../docs/acceptance/pr-145-quality-review.md)。

## 5. 本次后台通知变更的专项验收

此前 macOS 记录属于旧接收方案，不能作为本次 UI/真实模型已通过的证据。更新到最新提交后刷新页面，避免旧前端继续发送已删除的 documentScope 字段。本次只扩展已有 JSONB 内容类型，不新增数据库列或 migration。

1. 主线和 A/B 分栏都没有「主线待接收更新」、勾选、「恢复默认」或系统通知分隔线。
2. A 更新 F1 后，主线和 B 各发送新消息。检查对应用户消息 Parts：`data-document-update-notices` 只有版本/摘要/来源，无全文；某 Thread 的有效响应不消费另一 Thread 的通知。
3. 询问 F1 的具体方案时，检查 `readProjectDocument` 工具结果实际包含最新版；闲聊或无关问题不要求 AI 逐份读文档。通知本身不应导致写入。
4. 让 F1 连续更新 12 次后再在未获通知的 Thread 发消息：最近 10 条摘要加 omittedChangeCount，随后按需读取完整最新版。
5. 第四轮读取旧版、第七轮读取新版；比较实际模型请求：旧消息和旧全文均保持，通知和新版读取只追加。提供商缓存命中率不作为固定前缀的唯一证据。
6. 刷新、编辑最新消息、重试失败回复、划选后立即发送分支首轮均正常；已保存通知不追随后来的 head。
7. 文档面板打开期间其他分支更新，目录同步到当前版本；正在看的历史页、选区和草稿保持不动。

自动检查新增：`node --import tsx e2e/thread-chat/document-update-notices.test.mjs`。原生独立库仍运行 `pnpm test:thread-chat:documents-db`。
