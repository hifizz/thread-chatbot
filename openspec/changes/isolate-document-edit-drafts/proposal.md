## Why

同一条 assistant 回复修改已有文档时，模型可能多次试错、先做小范围测试，再完成剩余修改。当前 `updateProjectDocument` 每次成功都会直接创建正式 Artifact、Revision 并推进 head，导致中间试验进入正式历史，用户收到多个版本。

本 Change 对应 [Issue #160](https://github.com/hifizz/thread-chatbot/issues/160)，采用范围受控的方案 C：以已有 `assistant messageId + documentId` 标识本轮修改过程，引入持久化草稿和检查点，将编辑与正式提交分离。

目标是：同轮同文档可以多次编辑，最多产生一个正式版本；最终正文未变化则不新增版本；停止、失败和步骤耗尽不自动发布草稿。它不是卡片去重补丁，也不保证模型生成的内容一定完整。

## What Changes

- 增加 `document_drafts` 和 `document_checkpoints`，每轮每文档只有一个工作副本；成功且有变化的编辑保存完整检查点，失败及无变化操作保存收据。
- **BREAKING（新生成工具协议）**：新执行不再注册即时发布的 `updateProjectDocument`，改用 `editProjectDocument`、`commitProjectDocument` 和受控的 `resetProjectDocumentDraft`。历史工具结果保持可读，不迁移、不重新执行。
- `readProjectDocument` 在本轮存在工作副本时默认读取草稿；显式历史读取返回固定正式版本，不隐式切换基础。项目文档 HTTP 当前读取、目录和历史 Artifact 的语义不变。
- 编辑使用草稿序号和完整读取收据；正式提交校验基础正式版本，原子创建 Artifact、Revision、推进 head、结束草稿并保存收据。
- 将调用级幂等与草稿级提交唯一性分离，换 `toolCallId` 或并发提交不能产生第二个正式版本。
- 冲突保留草稿；重新读取新正式版本后，显式重置并重新生成 edits，不自动合并，不只替换版本号。
- Stop、生成终态和孤儿执行恢复关闭未提交草稿，但保留正文与检查点；已提交事实不被撤销。
- 扩展参数错误留痕及持久化失败预算；流结束、末步产物兜底和自然语言成功说明都不能替代正式提交。
- 将编辑过程与正式交付分开显示；每轮每文档最多一张最终版本卡片，重复收据和失败过程仍可查看。

## Capabilities

### New Capabilities

- `document-edit-drafts`：本轮工作副本、序号、检查点、显式重置、生命周期、恢复和只读审计。

### Modified Capabilities

- `project-documents`：将立即发布改为草稿最终发布，增加草稿级提交唯一性和分层审计，保留正式版本及固定引用合同。
- `document-update-tools`：拆分编辑与提交，调整读取收据、冲突恢复、失败预算和工具生命周期。
- `document-update-context`：区分草稿读取与正式全文，显示草稿进度及唯一最终交付，保持历史工具结果兼容。

### 依赖规范的实际状态

本提案基于仓库提交 `a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5`。上述三个被修改能力当前位于 `openspec/changes/add-shared-project-documents/specs/`，尚未成为 `openspec/specs/` 主规范。

本包的三个 `MODIFIED Requirements` 文件是相对于该依赖 Change 的增量，不宣称主规范已经存在。实施可依据现有代码开展，但本 Change 不得先于依赖同步或归档；合入时必须协调两个 Change 的合同，归档前先确认依赖实际具备归档条件并建立正确基线。不得把未验收任务勾选完成，不得为规避依赖而把既有能力重新声明为全新能力。

## Impact

- **建议路径**：`openspec/changes/isolate-document-edit-drafts/`。
- **服务端**：修改文档合同、应用服务、收据和版本仓储；复用现有编辑算法、可信执行身份、权限及锁协议。
- **数据**：新增草稿和检查点；Revision 增加可空 `sourceDraftId` 唯一关联。旧版本保持原样，不添加会拒绝历史多次提交的全局唯一约束。
- **生成与恢复**：接入工具注册、生成计划、SDK 错误适配、Stop、finalize、孤儿失败处理及 `restoreDocumentToolParts`。
- **客户端**：新增只读草稿检查点查询与过程展示，扩展工具类型及历史兼容；不引入人工编辑器或浏览器写入 API。
- **验证**：复用现有文档数据库与流式测试，补充真实 PostgreSQL 并发、故障注入、浏览器和真实模型验收。
- **数据库发布**：功能分支仅在独立数据库执行 `pnpm db:push`；不得生成或修改 `drizzle/`。由 develop 单一集成任务生成并验证 migration 后才可发布。
- **范围外**：通用任务平台、自动合并/CRDT、跨轮恢复继续编辑、检查点压缩、多文档原子提交、意图识别重构、历史版本合并删除、自动保证内容完整。

## Planning Status

本包为规划文档，未写入仓库、未执行 OpenSpec CLI、未实现代码、未运行类型检查或测试。依照项目 propose 工作流，本次交付后停止，等待单独授权进入实施。

## References

- [AGENTS.md](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/AGENTS.md#L11-L30)
- [CLAUDE.md：数据库迁移约定](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/CLAUDE.md#L38-L46)
- [OpenSpec propose 工作流](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/.agents/skills/openspec-propose/SKILL.md#L9-L24)
- [当前即时更新服务](https://github.com/hifizz/thread-chatbot/blob/a66113f7a0b0f938d02b9b0c785c3045bc9c3fb5/lib/thread-chat/application/documents/service.ts#L68-L111)