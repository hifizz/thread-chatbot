## 1. 领域契约与数据库迁移

- [x] 1.1 在 `constants/` 增加 Project Contract 长度、Project File context budget 和相关用户文案常量；禁止在 schema、route、prompt 和 UI 中重复 magic values
- [x] 1.2 扩展 `projects`：增加 nullable `target`、nullable `instructions`、非负 `contract_version default 0`，并增加相应 check constraint
- [x] 1.3 新增 `project_files` 成员关系表：`project_id`、`attachment_id`、`added_at`、组合主键、Attachment 唯一归属和 owner-scoped 查询所需索引
- [x] 1.4 生成 Drizzle migration，检查现有 Project 默认值、cascade 行为、Attachment 保留语义和回滚兼容性
- [x] 1.5 扩展 `ProjectDTO`、`ProjectBootstrapDTO`，新增 `ProjectFileDTO` 和 Artifact 来源展示所需 DTO；保持旧字段和客户端解析兼容

## 2. Commands、Repositories 与 API

- [x] 2.1 定义 `UpdateProjectContractCommand`、`AddProjectFileCommand`、`RemoveProjectFileCommand` Zod schema 与类型，包含 `commandId`、Contract 乐观版本和严格 payload 校验
- [x] 2.2 在 Project repository 增加 owner-scoped Contract/File lock、list、insert、remove 查询，并确保非法 id 统一返回 Not Found/State Conflict 而不泄露存在性
- [x] 2.3 实现 Contract 原子更新：校验 `expectedContractVersion`、trim/空值归一化、版本加一、Archived Project 拒绝和幂等 replay
- [x] 2.4 实现 Project File add：校验 Project/Attachment 所有权、Attachment 单 Project 归属、重复 add 幂等和 Archived Project 拒绝
- [x] 2.5 实现 Project File remove：只删除成员关系，不删除 Attachment row/R2 object，并保持历史 Message file parts 可读取
- [x] 2.6 扩展 Project Bootstrap query，一次返回 Contract、Project Files、全 Project Artifacts 及 Artifact 来源 Thread/Message 状态，避免 UI N+1 请求
- [x] 2.7 扩展 v1 handlers/routes/client：Project PATCH 支持 Contract command；新增 Project Files POST/DELETE；统一 command response、no-cache 和错误映射

## 3. Project Contract 模型上下文

- [x] 3.1 新增共享 `buildProjectContractContext` 纯函数，输出稳定结构并测试空 Contract、省略规则、XML/特殊字符处理和长度边界
- [x] 3.2 在 Generation 初始化阶段 owner-scoped 加载 Project Contract，将 `contractVersion` 作为本次 Generation 快照固定，不从客户端 Message 获取 Contract
- [x] 3.3 扩展 `prepareGeneration`/system 组装：在全局 Agent 规则之后、Conversation Messages 之前注入非空 Project Contract，并明确 Target、Instructions、当前请求和非指令资料的优先级
- [x] 3.4 记录安全的 observability metadata：Contract Version 与是否存在 Target/Instructions，不记录完整 Contract 正文
- [x] 3.5 增加并发验收：生成启动后修改 Contract 不影响运行中请求，下一次请求使用新版本；旧 Fork 使用当前 Contract 但冻结历史不变

## 4. Project File 内容选择与模型注入

- [x] 4.1 从 `resolve-attachments.ts` 抽取可复用 Attachment Content Resolver：批量查 owner-owned rows、PDF 全文/检索/截断、manifest、页码引用和错误降级
- [x] 4.2 定义一次 Generation 的文件快照：加载当前 Project File ids/status，并与有效 Message Attachments 按 Attachment id 去重
- [x] 4.3 实现确定性预算策略：显式 Message Attachments 优先，Project File manifest 始终轻量可见，Ready PDF 使用剩余预算检索或按页截断
- [x] 4.4 对 uploading/failed/不支持内容理解的类型输出准确 metadata 或跳过正文，禁止把未解析内容描述为已读取
- [x] 4.5 将 Project File Context 接入统一模型消息编译链路；添加/移除 File 只影响后续 Generation，不改写历史 Message/Fork/Artifact
- [x] 4.6 记录 Project File observability metadata：总数、ready 数、选中数、注入字符数和 retrieval/fallback 模式，不记录正文或默认文件名

## 5. 客户端状态与 Project Workspace Commands

- [x] 5.1 扩展 normalized conversation state/bootstrap mapper：保存 Contract、Contract Version、Project Files 和 Artifact 来源元信息
- [x] 5.2 扩展 HTTP client 与 runtime commands：读取/保存 Contract、添加/移除 Project File，并在 command 成功后以服务端 DTO 原子更新 store
- [x] 5.3 为 Contract 编辑实现本地 draft、Save/Cancel、saving/error/stale-conflict 状态；取消不得写库，冲突不得丢失草稿
- [x] 5.4 为 Project File uploader 复用现有 Attachment presign/R2/ingest 客户端链路，在成员关系建立后显示 uploading/ready/failed 状态和可恢复错误
- [x] 5.5 确保 Project Panel 状态与列/画布 workspace 状态解耦但共享同一 store；刷新 Bootstrap 后恢复 Contract、Files 和 Artifacts

## 6. 统一 Project Panel 与资源体验

- [x] 6.1 在 Topbar 增加 Project 入口，并在 workspace overlays 中定义单一 Project Panel open/section/activeArtifact 状态
- [x] 6.2 实现 Overview 区域：Target、Instructions 展示和显式编辑；Archived Project 显示只读状态
- [x] 6.3 实现 Files 区域：上传入口、文件名/type/size/status/summary/error/时间、打开/下载和移除确认；同名文件保持独立条目
- [x] 6.4 实现 Artifacts 区域：使用全 Project Artifact 集合、按创建时间倒序、显示 kind/来源 Thread/来源状态/时间，并支持基础搜索或类型过滤
- [x] 6.5 抽取现有 Artifact Drawer 的共享 detail view；消息卡与 Project 列表打开同一 Project Panel Artifact detail，避免两个右侧 drawer 状态竞争
- [x] 6.6 实现 Artifact 来源定位：打开来源 Thread，在可行时滚动或短暂高亮 source Message；深层 Fork 和非 active path Artifact 同样可定位
- [x] 6.7 验证列视图、画布、窄屏/移动端和生成进行中打开 Project Panel 时，路由、列宽、画布视口、composer 与 SSE 状态不被重置

## 7. 自动化测试与 Agent Evaluation

- [x] 7.1 增加 schema/command/repository 测试：Contract 长度与空值、乐观冲突、幂等 replay、Attachment 单 Project 归属、Archived Project 拒绝和 remove 保留 Attachment
- [x] 7.2 增加 context 纯函数测试：Contract 结构、客户端伪造隔离、Attachment 去重、显式附件优先、统一预算、PDF retrieval/fallback、unsupported manifest
- [ ] 7.3 增加 API integration：Bootstrap 返回完整 Workspace；对未物化的随机 Project id 保持 `200 + project:null` 以支持先进入 Workspace、首条消息再原子创建 Project；对已存在但不属于当前用户的 Project，GET 同样返回不含任何资源信息的空 Bootstrap，避免泄露存在性；所有 Project mutation、Project File、Artifact、Thread/Message 等资源型 API 对跨用户/跨 Project 非法资源统一 Not Found，并在付费模型调用前拒绝
- [x] 7.4 增加 UI/e2e：Contract 保存/取消/冲突、Project File upload 状态与移除、全 Project Artifact 发现、Artifact detail 和来源定位、Archived 只读
- [x] 7.5 扩展 Agent eval fixtures/harness 以表达 Project Contract 与 Project Files，覆盖 Target/Instructions 遵循、PDF grounding、引用页码、更新边界和跨 Project 不泄漏
- [ ] 7.6 增加历史稳定性验收：Contract/File 更新不改变已完成 Message、已有 Artifact、Fork Context 或运行中的 Generation
- [ ] 7.7 验证 Artifact 不会因进入 Project 列表自动注入无关 Thread；当前/继承历史中的 Artifact 仍沿用现有序列化

## 8. 校验、迁移与文档

- [ ] 8.1 运行 `pnpm db:generate` 并人工复核 migration；在干净数据库与现有数据副本上运行 `pnpm db:migrate`
- [ ] 8.2 运行 `pnpm typecheck`、目标 ESLint、相关测试、Agent eval smoke/CI、`pnpm build` 和 `pnpm openspec:validate`
- [ ] 8.3 更新 `CLAUDE.md`/相关开发文档：Project Contract 注入边界、Project File membership、统一预算、Project Panel 与明确 Non-Goals
- [ ] 8.4 保存上线验收记录：旧 Project 兼容、R2 未配置错误、Embedding 不可用降级、Archived Project、跨用户隔离和应用回滚行为
