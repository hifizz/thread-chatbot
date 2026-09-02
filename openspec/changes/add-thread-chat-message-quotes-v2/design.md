## Context

本设计只处理一个核心问题：Quote 应当怎样存在于 User Message 中，以及怎样避免具体引用破坏 Fork 的共同缓存。完整缓存工程拆到后续小 change，不在这里一次完成。

当前 Base 已有：

- 规范化的 Project、Thread、Message 与 Artifact；
- `threads.parentId / forkMessageId / forkContext / forkAnchor / anchorText`；
- `messages.parts` JSONB；
- `TextAnchor`；
- `messages.replacesMessageId / supersededAt`。

其中 Thread 字段记录“Child 从哪里分出来、继承哪些 Message”，Quote Part 记录“某条 User Message 最终选择把哪段文字发给模型”。两者生命周期不同，不能互相代替。

## Goals / Non-Goals

### Goals

- 用一个最小、可持久化的 Quote Part 支持同 Thread 多 Quote、划选后 Fork、编辑回显和来源导航。
- 让 Fork 预填 Quote 可删除；删除后不影响 Child 和继承历史。
- 保持 Quote 文本快照稳定，并严格隔离模型可见内容与 UI 元信息。
- 把具体 Quote 放在继承历史之后的当前 User Message，保留可复用的共同前缀。
- 移除只作用于 Child 继承历史的 6000 字符截断。

### Non-Goals

- 不实现“从 A11 直接点击分叉按钮”的 UI、命令或数据库调整。
- 不做任意跨 Thread、跨 Project、`@Thread` 或 Thread 合并。
- 不建立 Quote 表、反向索引、复杂来源对账、来源失效修复或模糊恢复。
- 不重写现有消息替换机制。
- 不在本 change 内完成所有 Provider 的缓存线路、联网研究、PDF、压缩和观测实现。

## Decisions

### D1：Fork 可以没有 Quote

由划选触发 Fork 时，Child Composer 初始可以有一份 Quote；这只是 UI 草稿。Fork 第一轮仍要求非空总体问题文本，Quote 是问题上下文，不单独触发生成：

- 总体问题非空且 Quote 仍在：第一条 User Message 包含 Quote 和问题；
- 总体问题非空且 Quote 已删除：第一条 User Message 只包含问题与用户保留的文件；
- 总体问题为空：无论预填 Quote 或文件是否仍在，都只创建 Child Thread，不创建 Message、不调用模型。

已经发送后再次编辑该 User Message，也可以删除 Quote。编辑产生替代 Message，原 Message 按现有 `replacesMessageId` / `supersededAt` 规则保留。

无论 Quote 是否存在，Thread 的 `parentId`、`forkMessageId`、`forkContext`、`forkAnchor` 和 `anchorText` 都不因 Quote 删除而变化。后两项在当前 Base 仍可服务于来源导航，但在 Quote 不存在时不得发给模型。

服务端不得执行以下兼容行为：

- 空 Fork 第一次发送时自动补入来源 Quote；
- Prompt 编译时根据 Thread 字段临时合成 Quote；
- 把“第一条 User Message 没有 Quote”解释为数据损坏。

### D2：Quote Schema 保持最小

```ts
export type ThreadQuoteSourceV1 =
  | {
      type: "message"
      messageId: string
      anchor: TextAnchor
    }
  | {
      type: "artifact"
      messageId: string
      artifactId: string
      anchor: TextAnchor
    }

export interface ThreadQuoteDataV1 {
  schemaVersion: "thread-quote-v1"
  text: string
  comment?: string
  source: ThreadQuoteSourceV1
}

export type ThreadQuotePartV1 = {
  type: "data-quote"
  data: ThreadQuoteDataV1
}
```

JSON 示例：

```json
{
  "type": "data-quote",
  "data": {
    "schemaVersion": "thread-quote-v1",
    "text": "被划选的原文快照",
    "comment": "请解释这一段",
    "source": {
      "type": "message",
      "messageId": "message_A11",
      "anchor": {
        "quote": {
          "exact": "被划选的原文快照",
          "prefix": "前文",
          "suffix": "后文"
        },
        "position": { "start": 120, "end": 129 }
      }
    }
  }
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 持久化 JSON 的演进标记；新捕获的 Quote 固定为 `thread-quote-v1`。 |
| `text` | 发送时冻结的划选文本；非空。后续来源变化不改写它。 |
| `comment` | 针对这一份 Quote 的可选用户批注；可以在编辑时修改或删除。 |
| `source.messageId` | 唯一必需的 Message 来源身份；Thread 与 Project 可由它查询，不重复存储。 |
| `source.artifactId` | 仅 Artifact 选区需要；同时保存其来源 Message ID。 |
| `source.anchor` | 用于未来跳回来源并定位选区；不发送给模型。 |

`text` 与 `source.anchor.quote.exact` 在同一 payload 内必须相等，避免出现两个互相矛盾的“原文”。这个检查只保证 payload 自洽，不要求服务端重新解析来源正文并证明选区真实性。

明确不保存：

| 不保存的字段 | 原因 |
| --- | --- |
| `required` | Quote 可删除；Thread 能否存在与 Quote 无关。 |
| Quote ID | Quote 没有独立生命周期；整份 Parts 随 Message 的现有替换机制保存，数组位置只表达顺序。 |
| 创建入口类型 | 从同 Thread加入还是由 Fork 预填，只影响创建时规则，不是持久化内容属性。 |
| Project ID / Thread ID | 可由 `messageId` 得到，重复保存会产生不一致。 |
| 来源状态、标题、脚注、坐标、DOM 路径 | 它们不是 Quote 内容或稳定身份。 |

### D3：创建时只做最小来源检查

普通 Quote 创建时，服务端只确认：

1. 来源属于当前用户和目标 Project；
2. 来源 Message 属于当前 Thread；
3. 来源 Message 为 `completed`；
4. Artifact Quote 的 `artifactId` 确实属于 `source.messageId`；
5. payload 自洽，并满足现有单条 Message 输入限制。

划选后 Fork 的预填 Quote 使用同一个 Schema，但只允许 Message 来源。若该 Quote 最终被保存，`source.messageId`、`text` 与 `source.anchor` 必须分别等于 Child 的 `forkMessageId`、`anchorText` 与 `forkAnchor`；这些值来自同一次 Fork 命令，来源 Message 必须为 `completed`。用户可以整块删除预填 Quote，但不能把它替换成同一 Message 或其他 Message 的另一段选区。这不是通用跨 Thread Quote 能力。

`text` 就是用户当时保存的快照。来源日后被替换、Anchor 定位失败或 UI 暂时无法返回来源，都不改写已保存 Quote，也不让历史 Message 失效。

### D4：编辑保存最终 Parts

编辑器从 User Message 的 `parts` 原序恢复普通文本、文件和所有 Quote Block。用户可以：

- 删除任意 Quote；
- 调整 Quote 顺序；
- 修改或清除某份 Quote 的 `comment`；
- 修改总体问题文本。

MVP 中 V1 Quote 的 `text`、`source` 和 `anchor` 作为同一个只读快照保存；如果引用不再需要，删除整个 Block。编辑不新增 Quote，也不能改写保留 Quote 的这三个字段。服务端必须让每个保留项与被替换 Message 中一份不同的旧 Quote 一一对应，旧 Quote 的可用次数不能被复制；只允许删除、排序和修改 `comment`。因此既能保留合法的 Parent Quote，也不能借 Edit 新增或复制跨 Thread Quote。

历史 `{ text: string }` Quote 没有 source/anchor，不能升级成 V1。Edit 可以把它原样一一保留、排序或删除，但不得修改 `text`，也不得为它新增 `comment`、`source` 或 `anchor`。这不是创建新 Quote，而是把旧 Message 中实际存在的 Part 带到替代 Message；同样不能增加重复数量。

提交后创建替代 User Message，保存编辑器最终得到的 Parts。服务端不得把被删除的 Quote 从原 Message 或 Thread 字段复制回来。以后若需要在编辑状态新增 Quote，再单独开放当前 Thread 来源并复用普通 Quote 检查。

### D5：模型只看到 Quote 正文与局部批注

模型转换使用一个确定性入口，按 `parts` 顺序处理 Quote。输出概念形式为：

```xml
<quote>
  <text>经过安全转义的 data.text</text>
  <comment>经过安全转义的 data.comment；没有时省略</comment>
</quote>
```

模型不得收到 `schemaVersion`、`source`、Message/Artifact ID 或 Anchor。总体问题仍来自普通 `text` Part。Quote 中即使包含命令式文字，也只是用户提供的被引用数据，不获得更高指令优先级。

只有 Message Parts 中真实存在 `data-quote` 时才输出 Quote。删除 Quote 后，`forkAnchor` 和 `anchorText` 也不得以其他 System、User 或隐藏字段形式进入模型输入。

### D6：缓存友好的 MVP 顺序

与 Quote MVP 有关的请求顺序为：

1. 该模式真实需要的工具定义与 System；研究计划等当前模式仍必须放在 System 的内容暂时保持原权威位置；
2. `forkContext` 指向的完整冻结历史；
3. Child 中已经完成的历史；
4. 当前 User Message 的 Quote、普通文本与文件。

具体 Quote 不进入历史之前的 System。在模型、Provider、工具/System 实际文本及历史 Message 的模型可见内容都相同的请求中，兄弟分支可以复用相同祖先前缀，并从各自真实的第一条 User Message 开始出现差异。

本 MVP 只保证 Quote 与 `anchorText` 不再制造更早差异。当前研究计划仍可能改变前置 System，历史 PDF 也仍可能被现有逻辑重新检索；它们是路线图中的独立已知问题，因此本阶段不宣称整个请求前缀在所有场景下都逐字相同。

MVP 删除 `INHERITED_CHAR_BUDGET=6000` 对 Child 历史的单独截断，也不插入“更早上文已省略”的伪 User Message。系统先使用原序完整历史；真正超过所选模型上下文时，MVP 在付费调用前返回明确错误。统一压缩方案放在后续 change。

缓存可以先在已支持的 Provider 或中转站启用，不要求先完成完整成本与质量观测。任何缓存参数都不得改变内容顺序、工具集合、工具强制调用方式、推理设置或成功/失败语义。

### D7：持久化与旧数据

Quote 继续存在于 `messages.parts` JSONB，因此 MVP 不增加表和数据库迁移。新捕获的 Quote 只产生 `thread-quote-v1`；历史 `{ text: string }` Quote 可以作为无导航能力的旧格式读取，并只把 `text` 发送给模型。Edit 可以把已有旧 Part 原样带到替代 Message，但不能伪造来源把它升级成 V1。

旧格式兼容只读取实际存在的 Part。历史 Child 第一条 User Message 如果没有 Quote，就保持没有 Quote；不根据 `forkAnchor` 或 `anchorText` 合成所谓的兼容 Quote。

## Risks / Trade-offs

### 删除 Quote 后模型不知道具体选区

这是用户的明确选择，不是数据丢失。模型仍能看到 `forkContext` 中继承的完整来源 Message，但不会再被告知具体选区。Thread 的来源导航信息继续保留。

### `TextAnchor` 同时保存 exact 与 `text`

这是复用现有导航合同带来的少量重复。通过 payload 内部相等规则消除歧义；MVP 不为此重做 Anchor 类型。

### 完整历史最终会达到模型限制

移除 6000 字符截断不是无限上下文承诺。它先消除 Fork 独有、会改变语义的粗略截断；达到真实限制后再使用所有 Thread 共用的稳定压缩方案。

### 不同联网/Artifact 模式仍可能首次缓存未命中

真实工具权限或 System 规则变化时，输入本来就不同。这不是 Quote MVP 的错误。后续按固定生成模式优化，不能靠扩大权限换取缓存命中。
