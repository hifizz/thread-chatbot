# PR #145 代码质量修复与本地验收

日期：2026-09-15。分支 docs/shared-project-documents，基于 #143 afc83d2。使用独立本机 PostgreSQL 数据库 wt_pr145_quality，未操作 Neon，未修改迁移或原有数据库配置。

## 修复批次

| Commit | 范围 |
| --- | --- |
| a46333f | 统一生成模式、工具选择、步骤预算、写入开关和 Markdown 限制，移除关键词路由 |
| bf7d92f | application/persistence 文档模块归组，SQL、事务写入、执行收据、上下文与 backfill 分责 |
| ecbaafa | 固定文档与 Artifact 上下文按顺序一次展开，共享去重和可信工具来源判断 |
| d5a0880 | 历史元数据查询、按需差异加载、版本导航状态、独立导出/分享错误恢复；修复菜单层级与重复 key |
| 40f216f | domain/streaming 文档模块归组；通用数据库重试常量脱离文档业务 |
| ebed36d | 修复带服务端文档清单的会话刷新崩溃，增加消息转换及不同文档独立提交回归 |

## 执行与证据

本机有效模型与认证环境复用但不输出凭据。开发服务端口 3015，独立认证 cookie 前缀。数据库命令由本地包装脚本验证 localhost 并将 DATABASE_URL、DIRECT_URL 同时指向独立库。

- `pnpm db:push`、`pnpm worktree:seed`：独立库成功。
- `pnpm typecheck`、相关修改文件 ESLint、`git diff --check`：通过。
- `pnpm test:thread-chat:documents`：Markdown edits 12 项，以及工具路由、使用收据、固定上下文、失败计划、预算错误、编辑内容转换回归通过。
- `pnpm test:thread-chat:documents-db`：原生 PostgreSQL 35 项通过，包含 CAS、原子性、幂等、隔离、Stop、归档、来源和项目删除。
- 原生输出实际包含「观察到 A/B 两条连接同时等待文档锁」；放行后一个成功、一个冲突。
- 原生输出实际包含「持有 F1 文档锁期间，另一份文档独立提交成功」。
- `node --import tsx e2e/thread-chat/artifact-reference-context.test.mjs`、`node --import tsx e2e/thread-chat/fork-quote.test.mjs`、`pnpm test:thread-chat:prompt-cache`：通过。

- `pnpm test:thread-chat:gate2-session`、`pnpm test:thread-chat:gate3-client`：通过。
- `pnpm openspec:validate`：38 项 strict 通过；tasks 为 26/33。

## EGO 与真实模型

| 场景 | 结果 | 证据/限制 |
| --- | --- | --- |
| 主线创建 F1，真实 @artifact 修改方案及复选框 | 通过 | GPT-5.6 Luna，readProjectDocument → updateProjectDocument；一个文档、两个版本，TODO2 保持原样 |
| 提交后刷新 | 通过 | 已修复用户内容转换异常；版本、真实来源与 committed 收据仍存在 |
| 版本 Dropdown、V1、差异 | 通过 | EGO 真实组件 fixture；菜单点击正常，旧正文保持不变 |
| 导出 V1 | 通过 | EGO 下载文件，内容为 V1 固定正文 |
| 分享失败后重试 | 通过 | fixture 注入 share 抛错，重试调用 share 两次；不代表系统分享成功 |
| 手机 390×844 版本展示 | 通过 | fixture 截图；不代表所有 Drawer、焦点和主题场景已覆盖 |
| 真实文档选区进入提问 | 通过 | 版本按钮 disabled，出现先完成/关闭提问提示；未模拟另一窗口更新 |
| A/B/C 分支完整模型流程及冲突重读 | 未验收 | 原生服务竞争已通过，不能替代模型多分支流程 |
| 删除目标、同名歧义、仅讨论、语义变化 | 未完成模型验收 | 保留现有应用服务和纯函数回归，不据此宣称模型行为全部通过 |
| 系统分享成功、完整主题/焦点矩阵 | 未验收 | 仅固定文件下载及分享失败恢复已测 |
| 写入开关关闭后重启及历史恢复 | 未验收 | 服务端规则已统一，仍需运行态回退验收 |
| 完整请求预算 | unknown | 没有可信 tokenizer/context window，不用字符数替代 token |
| 旧生产库迁移/登记恢复 | 未验收 | 独立库测试通过不等于旧库升级通过；迁移由 develop 集成 |

实际模型读结果指向当时 head，并返回 readId。更新一次提交两处修改，来源为真实主线 Thread/Message；本次不是 A/B 分支模型验收。[脱敏工具及版本证据](assets/pr-145-quality/real-model-evidence.json)。

- [真实模型更新](assets/pr-145-quality/real-model-update.png)
- [桌面差异](assets/pr-145-quality/desktop-diff.png)
- [手机 V1](assets/pr-145-quality/mobile-v1.png)
- [提问期间版本保护](assets/pr-145-quality/selection-guard.png)
- [导出的 V1 文件](assets/pr-145-quality/F1-v1.md)

本轮只新增勾选 tasks 2.1、3.2，其余完整验收门槛保持未勾选。不合并、不部署、不将本轮修复视为发布批准。

## 文档面板视觉复验（2026-09-15）

此前截图仅证明部分功能操作，不能视为视觉验收通过。本轮修复文档控制区缺少布局、按钮粘连、引用框误用、折叠入口不明确、任务项双重标记，以及输入范围说明继承右对齐小字的问题。顶部移除内部合同版本 v0，面板导航统一中文。

使用 EGO 在真实会话中逐张检查截图：1440×1000 桌面、390×844 手机、V1/V2 切换、范围清单展开、版本菜单及深色差异。工具栏间距、折叠箭头、任务项换行均可见；手机面板 scrollWidth 等于 clientWidth，无横向溢出；summary 聚焦后 Enter 能展开/收起。深色通过页面主题 class 验证，未覆盖系统主题切换流程。

- [桌面](assets/pr-145-ui/desktop.png)
- [手机](assets/pr-145-ui/mobile.png)
- [手机展开更新范围](assets/pr-145-ui/mobile-progress.png)
- [手机版本菜单](assets/pr-145-ui/mobile-menu.png)
- [手机固定 V1](assets/pr-145-ui/mobile-v1.png)
- [深色版本差异](assets/pr-145-ui/dark-diff.png)

TypeScript、相关 ESLint、Quote/分叉内容回归和 diff --check 通过。本轮通过范围为文档面板上述状态的视觉复验，不扩大为完整 A/B/C 功能验收；tasks 仍为 26/33。

## 阅读模式修正（2026-09-15）

上一轮仅整理控件，仍让项目管理信息占据大量首屏，不能代表阅读体验合格。本轮将文档预览与项目管理视图分开：预览页头只显示返回、标题、操作菜单与关闭，第二行显示版本与按需差异。项目导航和输入范围仅在管理视图出现；范围组件保持挂载以继续同步 head。来源、复制、导出及分享收进操作菜单。

EGO 真实会话验证：1440×1000 桌面和 390×844 手机的正文区域均从面板顶部 121px 开始；手机剩余约 86% 高度用于阅读，无横向溢出。逐张查看截图，检查默认阅读、展开差异和菜单；实际下载固定版本文件，Esc 关闭菜单；从消息打开预览再返回确实进入文档列表。TypeScript、ESLint、文档回归通过。测试期间用户也在同一验收库继续发消息，本轮没有新增模型请求或修改文档。

- [桌面阅读](assets/pr-145-reading/desktop.png)
- [手机阅读](assets/pr-145-reading/mobile.png)
- [按需展开差异](assets/pr-145-reading/diff.png)

这些检查只覆盖本轮阅读模式，不代表全部功能或全部无障碍场景验收完成。

## 当前文档统一目录（2026-09-15）

用户截图中的三个 F1 实际是同一 Document 的三个 Revision。@ 菜单此前直接列出历史 Artifact 缓存，造成重复候选。新增领域层 currentProjectArtifacts/currentDocumentArtifact，统一当前文档投影；@ 候选、项目列表、列表数量和顶部计数都使用它，页面不再各自比较版本。后端现有 GET /documents/:documentId 不传 revisionId 即读取当前内容；固定 Artifact 读取不变。

EGO 在真实三版本项目中观察 @ 候选仅一项；无版本参数的读取返回第三版及其固定 Artifact。没有发送模型请求或修改用户正文。补充并接入文档测试入口：多版本单项、独立同名、head 未载入、生成/失败来源不回退、流式旧元数据及历史快照不变。TypeScript、相关 ESLint、文档与客户端 store 回归通过。顶部计数改动在本轮浏览器收尾后完成编译，未将其热更新前观察值作为通过证据。

## 二次审查修复：目录与同步

- 当前目录改为服务端 Document 身份索引，移除客户端历史版本排序推断。
- 同步生命周期移入项目运行时，不依赖 Drawer；目录中的来源状态每次刷新，固定正文缓存不改写。
- 新目录与新正文使用一次 store 更新；旧版本与草稿保持。
- 新增 document-sync 回归，覆盖远端 generating → completed、原子刷新及释放后的写入保护。TypeScript、文档回归和客户端 store 回归通过。

## 二次审查修复：正文按需加载

- Bootstrap 和目录刷新只查询/返回 Artifact 元数据；所有历史卡片及来源身份仍保留。
- 正文独立缓存，打开固定 Artifact 时加载；未加载状态明确表示，禁止用空字符串参与复制、导出或模型输入。
- 刷新目录与重新打开面板不会清除已读取正文；来源定位等待正文加载后再执行。
- 独立 PostgreSQL 回归 40 项通过，包括新增元数据不含正文、历史正文按 ID 可读，以及原生 A/B 锁竞争与不同文档独立提交。

## 二次审查修复：有界通知查询

- 单次 SQL 先汇总当前 Thread 的通知游标与旧 commitId 收据，再筛选每文档最近 10 条摘要；省略数量在数据库计算。
- 应用层不再接收全部未通知提交再 shift 截断。
- 增加数据库返回行数上限和不连续旧 commitId 收据兼容检查。

## 二次审查修复：文档上下文边界

- 新摘要、旧全文清单、已读工具结果及 DocumentContextEntry 收拢到 application/documents/model-context.ts。
- 通用引用处理器保留一次从前往后的遍历，与文档处理共享 seen 集合；序列化文本保持不变。
- TypeScript、文档回归、真实 SDK 消息前缀及引用/旧清单双向去重回归通过。

## 本轮专项复验结果

| 场景 | 结果与证据 |
| --- | --- |
| Bootstrap 目录不包含正文 | 真实本地 API 200：1 个 Document、3 条 Artifact 元数据、0 条 Artifact 正文 |
| 固定历史读取 | EGO 从真实消息卡片进入 V2，再从菜单打开 V1；V1 保留未完成的 TODO6 与旧方案 |
| 显式读取最新版本 | 手机从 V1 点击查看最新版本，进入 V3，内容为未完成 TODO6 与盲评方案 |
| 桌面/手机阅读 | 实际查看截图；正文占主要空间，390×844 下无横向溢出 |
| 关闭抽屉后的 @ 候选 | 手机菜单只显示一条 F1 候选；测试输入已清除，未发送模型请求 |
| 跨窗口来源状态刷新 | 隔离同步回归覆盖 generating → completed、目录不变不重绘；本轮未新增真实模型跨窗口提交 |
| 通知/事务 | wt_pr145_quality 原生 41 项通过：双连接同时等待文档锁、不同文档独立提交、最近 10 条 SQL 返回上限、旧稀疏收据兼容 |
| 完整模型及系统分享 | 本轮未完成，保留原 OpenSpec 未勾选项 |

截图：[桌面 V1](assets/pr-145-second-review/desktop-v1.png)、[手机 V1](assets/pr-145-second-review/mobile-v1.png)、[手机最新版](assets/pr-145-second-review/mobile-current.png)、[手机单一引用候选](assets/pr-145-second-review/mobile-mention.png)。

本轮执行：pnpm typecheck、pnpm test:thread-chat:documents、pnpm test:thread-chat:gate3-client、node --import tsx e2e/thread-chat/artifact-reference-context.test.mjs、node /tmp/pr145-db.mjs pnpm test:thread-chat:documents-db、相关 pnpm exec eslint、pnpm openspec:validate（38 项）、git diff --check。未手动格式化，未修改迁移或 Neon，未合并/部署。EGO 空间仍使用「PR 143 本地验收」，新增测试标签已关闭，用户原标签保留。

最后清理：Artifact 元数据删除无消费者使用的可变 currentRevisionId；目录未变化时不触发会话重绘，检查不遍历缓存全文。
