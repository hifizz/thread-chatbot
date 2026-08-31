# Thread Chat 分叉对话缓存优化调研（产品与架构易读版）

> **文档阶段：Research**  
> **面向读者：产品经理、设计者和希望系统理解大模型缓存的工程师**  
> **目的：先帮助读者判断方向是否正确，再由 OpenSpec 进入详细设计和实施。**

详细后端合同和工程任务见：

```text
openspec/changes/optimize-thread-chat-prompt-cache/
```

---

## 一、30 秒结论

我们要解决的问题是：

> 用户从一段长对话里创建多个分支时，每个分支都会重复把相同历史交给模型阅读；如果请求结构没有设计好，不仅回答更慢，还会反复支付昂贵的输入费用。

推荐方案不是“再加一个 Redis”，也不是简单打开一个缓存开关，而是系统性管理每次发给模型的内容：

```text
固定工具与规则
    ↓
Project 固定信息
    ↓
分叉前的共同对话
    ↓
当前分支已经完成的对话
    ↓
本轮研究计划等动态控制
    ↓
当前用户消息：一份或多份引用 + 问题 + 附件
```

最关键的变化是：

> 用户在 A 中划选的文字不再进入最前面的 System Prompt，而是成为 B1 用户消息里的结构化引用。

因此两个兄弟分支可以一直共享：

```text
固定规则 + A 的共同历史
```

直到各自的 B1 才开始不同。

---

## 二、缓存是什么

可以把模型理解成一个每次回答前都要阅读资料的人。

一次请求可能包含：

```text
产品规则
项目背景
过去十轮对话
当前问题
```

没有缓存时，模型每次都重新处理整份材料。

有 Prompt Cache 时，如果下一次请求从开头开始仍然有一大段完全相同的内容，模型服务商可以复用上次处理这段内容的中间计算，只重新处理后面变化的部分。

缓存保存的不是最终答案，而更接近：

> “模型已经读懂前面这段输入后的计算结果。”

它主要带来：

- **更快**：减少开始回答前的重复处理；
- **更省**：缓存读取 Token 通常比普通输入便宜；
- **分支越多越划算**：同一段祖先历史能被多个后代复用。

---

## 三、为什么请求顺序决定缓存

最重要的规则是：

> 两次请求必须从最开头开始，拥有足够长、顺序一致、内容一致的共同部分。

理想结构：

```text
请求 B：固定规则 + A 的共同历史 + B1
请求 C：固定规则 + A 的共同历史 + C1
```

共同部分可以复用到 A 历史结束。

错误结构：

```text
请求 B：固定规则 + B 的选中文字 + A 的共同历史 + B1
请求 C：固定规则 + C 的选中文字 + A 的共同历史 + C1
```

B/C 的选中文字很早就不同，后面的 A 历史即使完全一样，也不再是连续的相同开头。

当前代码更接近第二种结构，所以需要调整。

---

## 四、当前 B1 到底应该是什么

假设用户在 A2 中划选：

```text
复用相同的输入前缀
```

然后输入：

```text
为什么必须是相同前缀？
```

推荐的 B1 不是一个简单拼接字符串，而是一条有结构的用户消息：

```text
B1
├── Quote 1
│   ├── 冻结正文：复用相同的输入前缀
│   └── 来源：Project / Thread A / Message A2 / TextAnchor
└── Text
    └── 为什么必须是相同前缀？
```

发给模型时只保留：

```text
【引用】复用相同的输入前缀
【问题】为什么必须是相同前缀？
```

模型不需要看到：

```text
Thread ID
Message ID
Project ID
文字位置
标题
脚注
列位置
```

这些信息只服务产品功能，例如未来点击引用后跳回 A2 并高亮原文。

---

## 五、为什么 Quote 要支持多份

未来一条问题很可能同时引用多处内容：

```text
引用 1：A2 的结论
引用 2：C4 的反例
问题：这两个结论冲突吗？
```

因此不能把引用建模成：

```ts
message.quote = 一个对象
```

而应利用消息本身的 Parts 顺序：

```text
Quote Part 1
Quote Part 2
Text Part
File Part
```

这样每一份引用都能：

- 独立展示；
- 独立跳转来源；
- 独立删除或排序；
- 独立转换给模型；
- 保留用户选择顺序。

---

## 六、引用正文和来源元信息为什么要分开

一份 Quote 同时服务两个目标：

### 给模型理解

模型只需要知道：

```text
用户引用了什么文字
```

### 给产品导航

产品需要知道：

```text
来自哪个 Project
来自哪个 Thread
来自哪条 Message
在那条 Message 的什么位置
```

所以一份 Quote 在数据库中可以理解为：

```text
Quote
├── text：冻结正文，模型可见
└── source：来源信息，模型不可见
```

这会带来三个好处：

1. 模型 Prompt 更短；
2. 内部 ID 不会泄漏给模型服务商；
3. 来源标题、位置等变化不会无意义破坏缓存。

---

## 七、数据库怎么保存

当前项目的 `messages.parts` 已经是 JSONB，适合保存有序 Quote Parts，因此第一阶段不需要新建 Quote 表。

继续保留两组数据：

### Thread 上的 Fork 数据

回答：

> 这个分支从哪里创建？

包括：

```text
parentId
forkMessageId
forkContext
forkAnchor
anchorText
```

### B1 Message 中的 Quote

回答：

> 这条用户消息当时引用了什么？

包括：

```text
quoteId
quote kind
冻结正文
来源 Project/Thread/Message
TextAnchor
```

两者看起来有重复，但职责不同。

Thread 是分支拓扑事实；B1 Quote 是消息内容快照。

---

## 八、两种创建分支方式必须一致

### 方式一：在划选弹窗中直接输入问题

系统在一个事务中完成：

```text
创建 Thread B
冻结 A 的继承历史
创建来源 Quote
创建 B1
创建等待生成的 Assistant Message
```

### 方式二：先创建空 B，稍后再提问

当用户第一次在 B 发送消息时，服务端发现：

```text
这是 ForkedThread
并且还没有任何用户消息
```

于是自动把分支来源 Quote 加进第一条消息。

这样不会出现：

```text
弹窗带问的 B1 有引用
空分支后首问的 B1 没引用
```

---

## 九、编辑 B1 时如何处理引用

普通“编辑问题”只应修改问题，不应悄悄修改引用来源。

例如：

```text
原 B1：
  Quote A2
  Quote C4
  为什么它们冲突？

编辑后：
  Quote A2
  Quote C4
  请用表格比较它们。
```

Quote ID、正文、来源和顺序都保留。

未来如果产品允许用户在编辑时增删 Quote，应设计显式的 Composer Draft 或新命令，不应让普通文本编辑隐式改变来源。

---

## 十、如何系统判断一个元素会不会破坏缓存

可以使用下面四类方法。

### 1. 必须稳定并放在前面

```text
工具名称、说明和参数格式
Agent 基础规则
Project 固定指令
分叉前的共同历史
```

这些内容一变，后面的缓存通常都会失效。

### 2. 可以变化，但必须放在后面

```text
当前 Quote 正文
当前问题
本轮 Research plan
本轮附件
动态记忆和检索结果
```

这些变化是正常的，只要位于共同历史之后，就不会破坏前面的缓存。

### 3. 产品需要，但模型完全不需要

```text
Quote source IDs
TextAnchor
标题和脚注
列位置
Trace / Request / Message ID
时间戳
```

最好的缓存优化不是把它们放到后面，而是根本不发送给模型。

### 4. 必须主动划成不同缓存空间

```text
模型变化
实际 Provider 路线变化
工具权限变化
TTL 或数据保留策略变化
System/Quote 格式版本变化
```

这些情况不应该勉强共享缓存，而应明确记录为新的缓存分区。

---

## 十一、主要变化元素与处理方式

| 变化元素 | 会不会影响模型输入 | 正确处理 |
|---|---:|---|
| B/C 不同的 Quote 正文 | 会 | 放在 A 历史之后，只影响分叉点以后 |
| Quote 的 Thread/Message ID | 不应 | 不发送给模型 |
| Quote 的 TextAnchor | 不应 | 只用于导航和高亮 |
| 当前用户问题 | 会 | 放在最后 |
| Research plan | 会 | 放在稳定历史之后 |
| Thread 标题、脚注、列位置 | 不应 | 彻底排除 |
| 工具 Schema | 会，而且通常最靠前 | 使用少量固定 Tool Profile |
| System Prompt | 会 | 长期稳定、版本化，禁止动态 ID/Anchor |
| Project 指令 | 会 | revision 内固定；更新时接受 Project 级冷启动 |
| Model/Provider route | 决定缓存在哪 | 记录真实 route，并尽量保持路由亲和 |
| TTL | 决定缓存是否还在 | 区分冷启动、过期和真正 miss |
| 刚生成的 A2 | 可能还没作为输入缓存 | 第一个分支可能只部分命中，后续兄弟更容易命中 |

---

## 十二、Claude 为什么需要特别重视

Claude 模型输入价格高，而且显式缓存通常还涉及：

```text
创建缓存的成本
读取缓存的成本
缓存有效时间
是否落到同一上游路线
```

所以不能只看“命中率”，还要看：

```text
缓存写入了多少
后来读取了多少
一份缓存被多少分支摊销
首 Token 是否变快
最终真实输入成本下降多少
```

首批上线应优先选择一条真实 Claude route 做验证，但不能因为代码用了 Anthropic SDK 就假设代理服务一定支持缓存。OpenRouter、UMAPIS、Vercel Gateway 等不同路线要分别验证。

---

## 十三、为什么不能承诺第一次分叉完整命中

假设模型刚生成 A2。

生成 A2 时，A2 是模型输出，不是输入：

```text
输入：A1 ... 用户问题
输出：A2
```

用户立刻从 A2 分叉时，A2 第一次作为输入出现在 B 的请求里。

因此第一个分支可能只复用 A2 之前的历史；当第一个分支已经把 A2 发给模型后，第二个兄弟分支才更可能连 A2 一起复用。

所以系统要区分：

```text
请求结构正确
缓存还是冷的
只有部分历史温了
Provider 真实读取了缓存
Provider 没返回证据
```

不能把所有“没有 read token”都归咎于 Prompt 结构。

---

## 十四、推荐的后端实施顺序

### 第一阶段：先把 Quote 数据合同做对

```text
Quote V1 类型
多 Quote Parts
来源验证
数据库快照
两条首问路径一致
编辑保留 Quote
模型只接收正文
```

### 第二阶段：重构 Prompt 顺序

```text
稳定 System
冻结祖先历史
分支历史
Runtime
当前用户 Quote + 问题
```

### 第三阶段：稳定工具和模型路线

```text
Tool Profile
Resolved Model Route
Provider 能力表
Affinity
Cache breakpoint
```

### 第四阶段：观测和评测

```text
Prefix Hash
Cache read/write Token
TTFT
成本
质量和工具回归
```

### 第五阶段：再做前端

```text
多引用 Composer
Quote Pill
删除和排序
点击回来源
定位 Message
高亮 TextAnchor
```

先冻结后端合同，再设计 Composer，避免前后端同时猜协议。

---

## 十五、核心风险

| 风险 | 表现 | 发现方式 | 纠偏 |
|---|---|---|---|
| Quote 从 system 移到 user 后模型理解变差 | 指代错误、忽略引用 | 回答质量和引用 case | 精简稳定 Kernel 规则，route 级回滚 |
| Tool Profile 过多 | 缓存被切得太碎 | Profile 分布和 Prefix Hash | 合并语义相同 Profile，但不扩大权限 |
| Tool Profile 过大 | Token 增加、误调用 | 工具调用和成本 case | 拆分安全能力面 |
| 代理不支持缓存字段 | 请求失败或 usage 缺失 | Provider probe | 降级普通请求，标记 probe-required |
| Quote JSONB 无 FK | 数据损坏时来源无效 | parser/事务测试 | 先应用校验；需要反向查询时增加派生索引 |
| 第一次分叉被误判为失败 | 冷启动导致 read=0 | warm-up 对照实验 | 指标排除合法 cold-start |
| 只省钱但回答质量下降 | cache 指标好、答案变差 | baseline/candidate eval | 正确性 hard score 优先 |

---

## 十六、这次的决策点

### 已建议确定

1. Quote 放进用户 Message，不放具体正文进 System Prompt。
2. 一条 Message 支持多份重复 `data-quote` Part。
3. Thread Fork 数据继续保存；B1 Quote 是消息快照。
4. Quote 来源元信息不发送给模型。
5. 第一阶段继续使用 `messages.parts` JSONB，不新建 Quote 表。
6. 普通 Edit 保留 Quote，不隐式修改来源。
7. 后端合同先完成，Composer 下一阶段再调研。

### 实施前需要校准

1. stopped assistant Message 是否允许被 Quote；
2. Quote 数量和总字符初始上限是否需要调整；
3. 首批验证哪条 Claude route；
4. 默认只使用短 TTL，还是部分场景验证 extended TTL；
5. 何时需要反向 Quote 索引表。

---

## 十七、一句话总结

> 系统化缓存的核心不是“加一个缓存开关”，而是把每个输入元素分清：稳定的放前面，变化的放后面，不需要给模型看的完全不发送，模型/工具/保留策略变化则主动分区。

在 Thread Chat 中，这意味着：

```text
A 的共同历史
    ↓
B1 的一份或多份 Quote
    ↓
B1 的问题
```

而不是：

```text
B 的具体 Quote 提前进入 System
    ↓
A 的共同历史
    ↓
B1
```

这既是缓存优化，也是后续多引用 Composer、来源导航和 Project Context 的基础。