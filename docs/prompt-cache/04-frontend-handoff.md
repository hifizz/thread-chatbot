# 下一阶段 Frontend Research 交接：Quote Composer

## 已冻结的后端合同

前端不得重新定义消息协议。下一阶段只需要选择合适的编辑器和交互组件来消费以下稳定合同。

### Draft

```ts
interface ThreadComposerDraft {
  text: string
  quotes: ComposerQuoteDraftItem[]
  files: ThreadComposerDraftFile[]
}
```

### Quote Draft Item

```ts
interface ComposerQuoteDraftItem {
  draftId: string
  origin:
    | "branch-origin"
    | "manual-selection"
    | "artifact-annotation"
  source:
    | MessageSelectionInput
    | ArtifactSelectionInput
    | BranchOriginDraftSource
  previewText: string
  comment: string
  required: boolean
}
```

### Submission

```ts
interface ComposerSubmission {
  text: string
  files: ThreadComposerDraftFile[]
  quotes: QuoteSelectionInput[]
}
```

转换必须统一调用：

```ts
composerDraftToSubmission(draft)
```

## 产品范围

v1 只支持：

1. 当前 Thread 中划选 completed assistant Message，加入当前 Composer；
2. 当前 Thread 的 Markdown Artifact 批量批注，回填该 Artifact 来源 Thread Composer；
3. 从父 Thread 划选创建 Fork，来源作为新 Thread 第一轮 required `branch-origin`。

v1 不支持：

```text
跨 Thread 引用
跨分栏引用
选择目标 Thread
@Thread
跨 Project 引用
Thread Merge
```

前端不得因为能看到另一个分栏，就把其 Message ID提交给当前 Thread；后端会拒绝。

## 空问题开分支

用户在划选弹窗不输入问题时：

```text
创建 Thread B
不创建 B1
不创建 assistant placeholder
不调用模型
打开 B
Composer 从 Thread Fork 字段重建 required Quote Block
```

重建调用：

```ts
initializeThreadComposerDraft(thread)
```

`branch-origin`：

- 必须排第一；
- `required=true`；
- v1 不可删除或替换；
- 提交时不进入普通 `quotes[]`，由服务端自动生成持久化 Quote。

## 多 Quote 行为

- 最多 50 个；
- 相同来源 + Anchor 重复添加时聚焦已有块；
- 非 required Quote 可删除和排序；
- 每份 Quote 有自己的 comment；
- Draft 总文本用于统一问题或总说明；
- 只有总文本非空，或至少一份 comment 非空时可发送；
- 发送一次只创建一条 User Message 和一次 assistant attempt。

现有纯函数：

```ts
addQuoteToDraft
addQuotesToDraft
removeQuoteFromDraft
moveQuoteInDraft
updateQuoteComment
canSubmitComposerDraft
composerDraftToSubmission
```

## Markdown 批量批注

每个批注转换成一个 `artifact-annotation` Quote Draft Item：

```ts
markdownAnnotationsToDraftItems(annotations)
aggregateMarkdownAnnotations({ draft, annotations })
```

批量确认只把 Quote 加入 Composer，不自动发送。

Artifact 必须属于当前 Thread 已完成回复。若用户当前处于其他 Thread，应导航回来源 Thread 或给出限制提示，不能把批注灌入当前 Composer。

## 待 Frontend Research 决策

以下内容没有在本 change 中预先决定：

- 继续使用 textarea，还是采用 Lexical/ProseMirror/ContentEditable；
- Quote Block 是输入框上方独立列表还是富文本内嵌节点；
- 50 个 Quote 时的虚拟化和折叠方式；
- 拖拽排序库；
- comment 内联编辑方式；
- Draft 在刷新后的持久化；
- 移动端布局；
- 点击 Quote 返回来源并使用 TextAnchor 高亮；
- 来源 supersede 或定位失败时的 UI 降级。

候选方案必须证明：

1. 不改变上述 Draft/Submission/Parts 合同；
2. 不引入跨 Thread；
3. 不在 Draft 阶段创建 Message 或调用模型；
4. 能稳定处理 50 个 Quote；
5. 保持键盘、输入法和可访问性。

## 后端安全边界

前端 `previewText` 只用于展示。服务端不信任它：

- Message Quote 正文取 `TextAnchor.quote.exact`；
- Project/Thread/Message/Artifact ID 由服务端解析并验证；
- `quoteId` 和持久化 kind 由服务端生成；
- 普通 Quote 的来源 Thread 必须等于 API 目标 Thread。
