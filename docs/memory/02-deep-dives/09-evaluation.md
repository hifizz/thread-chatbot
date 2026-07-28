# 评测方案：从公开 benchmark 到本项目最小实验

## 为什么不能直接排名选型

公开分数常同时改变 memory backend、生成模型、judge、top-k、prompt、数据清洗版本与 full-context 上限。厂商复测还可能只公布有利配置。阶段 3 的目标不是复现“SOTA”，而是回答本项目的工程问题：

- 应该记什么？
- 新事实如何替换旧事实？
- 读取是否把正确证据送给模型？
- 延迟、token 与错误写入是否可接受？

## 可用公开集

| 数据集 | 主要能力 | 适合用途 | 不足 |
| --- | --- | --- | --- |
| [LoCoMo](https://github.com/snap-research/locomo/tree/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376) | 多 session 事实、时间、多跳 | 兼容业界结果、长对话回放 | 仅 10 段对话；judge 与配置敏感 |
| [LongMemEval](https://github.com/xiaowu0162/LongMemEval/tree/9e0b455f4ef0e2ab8f2e582289761153549043fc) | extraction、多 session、knowledge update、时间、拒答 | 当前值与新鲜度 | 合成/编排成分较高 |
| [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2) | agent 经验、环境定制 | 后续程序性记忆 | 超出第一版用户事实范围 |

第一轮不要跑完整排行榜。先抽 20–50 题，并加入本项目自己的中文/英文 fixture。

## 必须分层计分

端到端“答案对不对”无法定位问题。每个样本至少记录：

1. **write precision/recall**：该写的事实是否写入，不该写的是否被记住；
2. **state accuracy**：当前值、旧值、有效时间是否正确；
3. **retrieval recall@k**：正确证据是否进入候选；
4. **context precision**：注入的无关/矛盾记忆比例；
5. **answer correctness**：模型最终答案；
6. **abstention**：没有证据时是否承认不知道；
7. **privacy/control**：删除后是否停止召回、跨用户是否绝不泄露；
8. **cost/latency**：写入调用数、tokens、读 p50/p95、增加的输入 tokens。

## 本项目 fixture 格式

建议把测试用例版本化为 JSON：

```json
{
  "id": "knowledge-update-city-zh",
  "userId": "u-a",
  "events": [
    { "at": "2026-01-01", "text": "我现在住在杭州。" },
    { "at": "2026-06-01", "text": "我搬到新加坡了。" }
  ],
  "query": { "at": "2026-07-01", "text": "我现在住哪里？" },
  "expected": {
    "answerFacts": ["current_location=Singapore"],
    "inactiveFacts": ["current_location=Hangzhou"],
    "mustNotContain": ["Hangzhou is current"]
  }
}
```

同一 fixture 必须可喂给三个 backend，避免每种方案使用不同数据加工。

## 第一轮 30 题组成

| 类别 | 数量 | 示例 |
| --- | ---: | --- |
| 稳定偏好 | 5 | 语言、格式、饮食 |
| 当前值更新 | 6 | 城市、项目、职位变化 |
| 时间与过期 | 4 | 旅行结束、临时计划 |
| 多 session 组合 | 4 | 分散透露的人/项目关系 |
| 否定与撤回 | 3 | “我不再…”、“忘掉…” |
| 不应记忆 | 3 | 寒暄、assistant 幻觉、一次性敏感信息 |
| 删除与隔离 | 3 | 删除后不召回、u-a/u-b 隔离 |
| 拒答 | 2 | 从未提供的信息 |

至少一半中文，全部包含稳定 ID 和绝对时间。

## 对比组

在相同聊天模型、embedding、答案 prompt、预算下比较：

- A0：只给当前 session；
- A1：全历史；
- A2：历史 turn 向量 top-k；
- A3：Mem0 风格 ADD-only 记忆 + vector；
- A4：结构化 fact + 确定性 supersede；
- A5：A4 + 紧凑 profile + 长尾 vector。

若无法锁定模型采样，至少把原始抽取 JSON、检索结果和最终 prompt 保存，允许人工复核。

## 成功门槛

第一版不是追求最高 QA 分，而是满足上线底线：

- 跨用户泄露：0；
- 删除后召回：0；
- current-value 冲突准确率：≥95%；
- 不应记忆 precision：≥95%；
- retrieval recall@6：≥90%；
- 在线读路径 p95：目标 <150ms（不含主模型）；
- 注入预算：默认不超过主上下文的 10%；
- 写入失败不影响聊天成功，且可重试、无重复事实。

这些是阶段 3 的初始工程门槛，不是已经测得的结果。

## 实验顺序

1. 先做纯函数 reducer：candidate facts -> state；
2. 再比较抽取 prompt/schema；
3. 再接 Postgres 与向量召回；
4. 最后接 `route.ts` 测真实流式延迟；
5. 通过后才设计 memory UI 和自动写入默认值。

## 需要记录的反例

每次失败都归入一个稳定 taxonomy：

```text
WRITE_MISSED
WRITE_FALSE_POSITIVE
ATTRIBUTION_ERROR
TEMPORAL_NORMALIZATION_ERROR
CONFLICT_RESOLUTION_ERROR
RETRIEVAL_MISS
CONTEXT_DISTRACTION
ANSWER_IGNORED_EVIDENCE
DELETION_LEAK
TENANT_LEAK
```

只看总分会掩盖安全性失败；taxonomy 才能指导下一轮修改。

## 阶段 3 的明确输入

阶段 2 推荐从 A4 开始，实现三个 predicate 的 30 题 fixture；A3 用同一数据作为对照。若 A4 没有在 current-value、删除和隔离上明显胜出，就不进入通用 schema 和 UI 开发。
