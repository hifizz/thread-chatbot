# 什么是「轻量消息 DAG」

这是一份辅助理解文档，不是正式的技术接口定义。

你暂时不需要理解“有向无环图”这种计算机术语。对于 thread-chat，可以先把“轻量消息 DAG”理解成一句话：

> 重新生成回复时，不删除旧回复，而是在同一个问题下面再保存一个新回复，并记录当前正在查看哪一个。

## 1. 现在的线性消息是什么样

目前，一个 Thread 里的消息可以理解为一条直线：

```text
用户问题 U1
    ↓
AI 回复 A
```

数据大致是一个数组：

```ts
messages: [U1, A]
```

如果用户点击“重新生成”，最简单的实现方式是直接清空 A，再把新的回复 B 写回 A 的位置：

```text
重新生成前：U1 → A
重新生成后：U1 → B
```

这种方式在线性聊天里看起来没有问题，但 thread-chat 还允许用户从 AI 回复中划选文字并创建右侧分栏。

## 2. 为什么直接把 A 替换成 B 会出问题

假设用户从回复 A 中划选了一段文字，创建了右侧的子 Thread X：

```text
主 Thread

U1 → AI 回复 A
          │
          └── 划选一段文字 → 右侧 Thread X
```

Thread X 的含义是：

> 我是在讨论回复 A 中的这段原文。

如果重新生成时直接把 A 的内容覆盖成 B，数据库里虽然可能还保留着相同的 messageId，但这个 ID 里面已经变成了完全不同的内容：

```text
U1 → AI 回复 B
          │
          └── Thread X？
```

这时会出现几个问题：

1. Thread X 原来引用的文字可能不再存在于 B 中。
2. 原来的划选高亮无法定位。
3. Thread X 的继承上下文会从 A 偷偷变成 B。
4. A 生成的 Artifact 可能被删除或错误地挂到 B 上。
5. 用户看到的右侧分栏还在，但它已经说不清自己的真实来源。

所以，仅仅“保留相同 messageId”并不能保护子分支。我们需要保留准确的旧消息版本。

## 3. 改成轻量消息 DAG 后是什么样

重新生成时，不覆盖 A，而是在同一个用户问题 U1 下面创建一个新的 AI 回复 B：

```text
                 ┌── AI 回复 A
用户问题 U1 ─────┤
                 └── AI 回复 B  ← 当前展示
```

A 和 B 都还存在，只是界面一次显示其中一个。

用户可以通过类似下面的版本切换器查看它们：

```text
‹  1 / 2  ›
```

当当前版本是 B 时，界面显示 B；切回第一个版本时，界面重新显示 A。

## 4. 数据上具体增加了什么

每条消息增加一个 `parentMessageId`，表示这条消息接在哪条消息之后：

```ts
interface Message {
  id: string
  parentMessageId: string | null
  role: "user" | "assistant"
  text: string
}
```

Thread 增加 `activeLeafMessageId`，表示当前正在展示哪个路径的最后一条消息：

```ts
interface Thread {
  messages: Message[]
  activeLeafMessageId: string | null
}
```

例如：

```ts
{
  messages: [
    {
      id: "u1",
      parentMessageId: null,
      role: "user",
      text: "请解释一下 DAG"
    },
    {
      id: "a1",
      parentMessageId: "u1",
      role: "assistant",
      text: "这是第一次回答 A"
    },
    {
      id: "a2",
      parentMessageId: "u1",
      role: "assistant",
      text: "这是重新生成的回答 B"
    }
  ],
  activeLeafMessageId: "a2"
}
```

这里：

- `a1.parentMessageId === "u1"`
- `a2.parentMessageId === "u1"`
- 所以 A 和 B 是同一个问题下面的两个回答。
- `activeLeafMessageId === "a2"`，所以界面当前显示 B。

如果用户切回 A，只需要把 `activeLeafMessageId` 改成 `a1`。A 的正文没有被删除，也不需要重新生成。

## 5. 为什么它叫“轻量”

它不是要引入图数据库，也不是要重写整个项目。

这里的“轻量”表示：

1. 消息仍然保存在现有的 `branch_trees.state` JSON 中。
2. `messages` 仍然可以用数组保存。
3. 只增加消息的父节点关系和当前展示指针。
4. P0 只允许当前最后一轮产生新版本。
5. 暂时不支持编辑任意历史消息，也不需要实现通用图编辑器。

因此，它只是把原来的“消息直线”稍微扩展成“末尾可以有几个备选方向”。

## 6. 编辑用户消息时会发生什么

假设原来的对话是：

```text
用户问题 U1 → AI 回复 A
```

用户编辑 U1 并重新发送后，也不应该直接修改 U1。系统会创建一个新的用户消息 U2，再生成回复 B：

```text
                    ┌── 用户问题 U1 → AI 回复 A
上一条消息 P ───────┤
                    └── 用户问题 U2 → AI 回复 B  ← 当前展示
```

这样可以保证：

- 原问题 U1 仍然存在。
- 原回复 A 仍然存在。
- A 下面的右侧分栏仍然有准确来源。
- 用户可以在 A 和 B 两条问答路径之间切换。

界面上可以只提供一个“问答版本切换器”，而不是分别切换 user 和 assistant，避免出现“显示 U1，却拼上 B”的错误组合。

## 7. A 产生的右侧分栏怎么处理

假设 Thread X 是从 A 的选区创建的：

```text
U1
├── A
│   └── 右侧 Thread X
└── B  ← 当前展示
```

当父列从 A 切换到 B 时：

1. Thread X 不删除。
2. Thread X 不自动迁移到 B。
3. 已经打开的 Thread X 分栏继续保持打开。
4. Thread X 的列头显示“基于回复 1/2 · 当前未展示”。
5. 用户点击“查看来源”后，父列切回 A。
6. A 原来的划选高亮和脚注随之恢复。

如果 Thread X 当时没有打开：

- B 的正文上不会显示属于 A 的脚注。
- 用户仍可以通过版本切换器、子树列表或画布找到 Thread X。

如果用户随后从 B 中划选文字创建 Thread Y：

```text
U1
├── A
│   └── Thread X
└── B
    └── Thread Y
```

X 永久绑定 A，Y 永久绑定 B。系统不会因为 A 和 B 中出现相似文字，就猜测并迁移子分支。

## 8. Artifact A 应该怎么处理

Artifact 也要绑定准确的 AI 消息：

```text
AI 回复 A → Artifact A
AI 回复 B → Artifact B
```

Artifact 数据需要记录 `sourceMessageId`：

```ts
interface Artifact {
  id: string
  sourceThreadId: string
  sourceMessageId: string
  title: string
  content: string
}
```

重新生成 B 后，Artifact A 不自动删除。

产品行为是：

- 当前展示 B 时，消息内默认展示 Artifact B。
- Artifact A 作为历史版本资产继续保存。
- 如果 Artifact A 的标签页已经打开，不强制关闭，只标记“来自回复 1/2 · 历史版本”。
- 切回 A 后，Artifact A 重新成为当前版本资产。
- 打开从 A 派生的 Thread 时，仍然可以看到 A 的来源关系。

不建议 regeneration 自动删除旧 Artifact，因为用户可能已经阅读、引用或基于它创建了子分支。

以后如果要支持删除，应当是用户明确执行的操作，并在删除前检查是否仍有消息或子 Thread 引用它。这不属于本次 P0。

## 9. 为什么还需要 tree revision

即使数据结构正确，还要处理多个浏览器标签页同时保存的问题。

例如：

1. 标签页一已经生成 B，树中同时存在 A 和 B。
2. 标签页二仍停留在只有 A 的旧页面。
3. 标签页二随后把整棵旧树保存回服务器。

如果服务器采用“最后一次写入覆盖前面内容”，标签页二仍可能把 B 删除。

因此每棵树需要一个递增的 `revision`：

```text
读取树：revision = 10
保存树：必须声明 baseRevision = 10
保存成功：服务器更新为 revision = 11
```

如果另一个标签页已经把 revision 更新为 11，旧标签页再用 `baseRevision = 10` 保存时，服务器会拒绝，而不是覆盖新树。

版本切换、generation transaction 和普通整树保存都需要遵守这个规则。

## 10. 两种“分支”不要混淆

thread-chat 中将同时存在两种不同的分支。

第一种是同一列中的消息版本：

```text
U1
├── Assistant A
└── Assistant B
```

它解决的是编辑和重新生成问题，通过 `1/2` 切换。

第二种是划选文字产生的跨列 Thread：

```text
Assistant A
└── 划选一段文字 → 右侧 Thread X
```

它解决的是对某段 AI 原文继续深入讨论的问题。

二者之间的关系是：右侧 Thread 必须绑定第一种分支中的某个准确消息节点。

## 11. 最终需要记住什么

只需要记住下面四条：

1. 重新生成不是覆盖，而是新增一个回复版本。
2. 当前界面只展示一个版本，但旧版本仍然存在。
3. 右侧 Thread 和 Artifact 永久绑定产生它们的准确回复版本。
4. tree revision 防止旧标签页把新版本覆盖掉。

最终结构可以概括成：

```text
用户问题 U1
├── AI 回复 A
│   ├── Artifact A
│   └── 右侧 Thread X
└── AI 回复 B  ← 当前展示
    ├── Artifact B
    └── 右侧 Thread Y
```

切换当前显示的回复，不等于删除其他回复，也不改变其他回复下面已经存在的内容。
