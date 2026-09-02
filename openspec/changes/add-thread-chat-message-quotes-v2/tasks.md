## 1. 文档与模型确认（本 PR）

- [x] 1.1 从 PR #49 的 Base 单独创建分支，不复用其实现
- [x] 1.2 定义可删除、无 `required` 的最小 Quote V1 Schema
- [x] 1.3 明确 Message Parts 是 Quote 是否存在的唯一依据，禁止自动补 Quote
- [x] 1.4 明确 Fork 继承完整历史并移除 Child 专属 6000 字符截断
- [x] 1.5 把缓存、动态工具、PDF、压缩和观测收敛到一份后续路线图

## 2. Quote MVP 合同

- [ ] 2.1 在 `ThreadChatDataParts` 中接入唯一 `thread-quote-v1` 类型与严格解析器，并兼容读取历史 `{ text }`
- [ ] 2.2 让 Composer 草稿支持同 Thread 多 Quote、排序、局部批注和删除；不保存 `required` 或创建入口类型
- [ ] 2.3 让划选后 Fork 只预填一份可删除 Quote；保留时其只读字段必须等于 Child 的 `forkMessageId` / `anchorText` / `forkAnchor`
- [ ] 2.4 保持空 Fork 只创建 Thread；总体问题文本为空时，Quote或文件草稿都不创建 Message、不调用模型
- [ ] 2.5 让普通 Send 只接受当前 Thread 的 completed 来源，让 Fork 预填来源只接受 Child 的 `forkMessageId`
- [ ] 2.6 让 Edit 回显现存 Quote 并保存删除、排序及 V1 comment 修改结果；保留项必须与旧 Quote 一一对应且数量不增加，继续使用 `replacesMessageId` / `supersededAt`
- [ ] 2.7 让 Edit 原样保留、排序或删除历史 `{ text }` Quote，禁止修改正文或伪造 V1 来源
- [ ] 2.8 删除 Send 与 Prompt 编译中根据 Thread 字段自动补 Quote 的所有路径

## 3. 模型输入与缓存

- [ ] 3.1 建立唯一 Quote-to-model 转换入口，只序列化安全转义后的 `text` 与可选 `comment`
- [ ] 3.2 从早期 System 移除具体 `anchorText`；Quote 只位于所属 User Message
- [ ] 3.3 移除 Child 专属 `INHERITED_CHAR_BUDGET=6000` 和伪 User 省略提示
- [ ] 3.4 在真实上下文超限时，于付费调用前返回明确错误；本 MVP 不静默截断或摘要
- [ ] 3.5 在已支持的 Provider/中转站启用缓存，同时保持 Prompt 语义、工具权限、强制工具行为和推理设置不变

## 4. 验收

- [ ] 4.1 覆盖同 Thread 0/1/多 Quote 的顺序、持久化和单次生成
- [ ] 4.2 覆盖 Fork 预填 Quote 被保留、被篡改拒绝、发送前删除、发送后编辑删除四条路径
- [ ] 4.3 覆盖 Quote 删除后 Child、`forkContext`、`forkAnchor` 与 `anchorText` 不变，且模型不再收到引用文本或 Anchor
- [ ] 4.4 覆盖空 Fork 不创建 Message、不产生模型调用
- [ ] 4.5 覆盖普通跨 Thread来源与非 completed 来源在模型调用前被拒绝
- [ ] 4.6 覆盖模型输入不含 Schema 版本、Message/Artifact ID 和 Anchor
- [ ] 4.7 覆盖超过 6000 字符但未超过模型限制的继承历史保持完整原序
- [ ] 4.8 覆盖历史 `{ text }` Quote 可读、Edit 可原样保留/排序/删除，以及历史无 Quote 的 Child 不被自动补 Quote
- [ ] 4.9 覆盖 Edit 不能新增 Quote、改写只读来源或复制已有 Quote 数量
- [ ] 4.10 运行 `pnpm typecheck`、`pnpm lint`、相关 Thread Chat 测试和 `pnpm openspec:validate`
