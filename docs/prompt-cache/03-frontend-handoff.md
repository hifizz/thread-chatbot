# Quote Composer 前端阶段交接

> 本文件只定义下一阶段前端 Research 的稳定输入，不提前决定具体 React 编辑器或视觉组件。

## 1. 已冻结的产品边界

v1 只支持：

1. 当前 Thread 的 completed assistant Message 选区加入当前 Composer；
2. 当前 Thread 的 Markdown Artifact 批量批注回填其来源 Thread Composer；
3. 父 Thread 选区创建 Fork，新 Thread 第一轮显示 required branch-origin Quote；
4. 一条 Draft 最多 50 个有序 Quote Block；
5. 用户最终一次发送，只产生一条 User Message 和一次 assistant attempt。

不支持：

```text
其他 Thread / 其他分栏 -> 当前 Composer
@Thread
跨 Project
Thread Merge
选择任意目标 Thread
```

## 2. Draft 类型

```ts
interface ThreadComposerDraft {
  text: string
  quotes: ComposerQuoteDraftItem[]
  files: ComposerDraftFile[]
}

interface ComposerQuoteDraftItem {
  draftId: string
  origin:
    | "branch-origin"
    | "manual-selection"
    | "artifact-annotation"
  source: MessageSelectionInput | ArtifactSelectionInput
  previewText: string
  comment: string
  required: boolean
}
```

`draftId` 只属于本地 Draft；发送后由服务端生成持久化 `quoteId`。

## 3. 输入动作

### 当前 Thread 划选

```text
划选 completed assistant Message
→ 操作：开新分支 / 引用到当前输入框
```

“引用到当前输入框”只调用 Draft action：

```ts
addCurrentThreadMessageQuote(draft, input)
```

如果来源 Thread 与目标 Composer 不同，纯函数和服务端都会拒绝。

### 空问题开分支

```text
Fork API 只创建 Thread
→ 打开新 Thread
→ branchOriginDraftFromThread(thread)
→ required Quote Block 固定在第一项
```

此时没有 B1、assistant placeholder、Trace 或模型调用。

### Markdown 批量批注

```text
多个 Artifact selection + 各自 comment
→ addArtifactAnnotationsToDraft(draft, annotations)
→ 返回 Artifact 来源 Thread Composer
→ 用户检查并一次发送
```

如果当前 Composer 不是 Artifact 来源 Thread，前端应导航回来源 Thread或提示限制，不能静默跨 Thread 写入。

## 4. Quote Block 行为

- 展示冻结正文预览；
- Artifact 批注展示自己的 comment；
- 非 required Quote 可删除；
- 非 required Quote 可调整顺序；
- required branch-origin 不可删除、不可被其他 Quote 排到前面；
- 相同来源 + Anchor 重复添加时聚焦已有 Block；
- 达到 50 个时禁止继续添加；
- Draft 未发送前不创建 Message、不调用模型。

## 5. 发送条件

Draft 至少满足一种意图：

```text
总文本非空
或
至少一份 Quote comment 非空
```

只有 Quote 正文、没有总问题和 comment 时，发送按钮保持禁用。

统一转换：

```ts
composerDraftToSubmission(draft)
```

Submission 只包含：

```ts
{
  text,
  files,
  quotes: QuoteSelectionInput[]
}
```

required branch-origin 不进入普通 `quotes[]`；服务端根据 Fork 字段生成。

## 6. 发送后的 Message Parts

```text
data-quote × 0..50
text × 0..1
file × 0..20
```

顺序必须与 Draft 一致。MessageDTO 不增加第二个顶层 `quotes` 字段。

## 7. 来源导航输入

持久化 Quote V1 已提供：

```text
真实 Thread ID
真实 Message ID / Artifact ID
TextAnchor
冻结 quote.text
```

未来点击 Quote 可：

1. 找到来源 Message/Artifact；
2. 使用现有 `position -> exact -> fuzzy` 定位；
3. 滚动并临时高亮；
4. 定位失败时仍展示冻结正文。

导航能力不等于跨 Thread Composer 引用能力。

## 8. 下一阶段需要调研的前端问题

- 继续使用 textarea + 外置 Quote 列表，还是引入 Lexical/ProseMirror；
- Quote Block 的折叠、预览长度和 comment 编辑；
- 50 个 Quote 的性能与虚拟化；
- 键盘操作和无障碍；
- Draft 是否只存内存、sessionStorage，还是服务端草稿；
- 移动端布局；
- 点击来源后的列导航与高亮动画；
- Markdown 批注如何批量进入 Composer。

这些问题不得改写本文件已冻结的 Command、Parts 和当前 Thread-only 语义。
