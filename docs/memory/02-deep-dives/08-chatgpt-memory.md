# ChatGPT memory：闭源产品行为参考

> 证据边界：ChatGPT memory 是闭源产品，本篇只记录 OpenAI 官方公开行为，不声称知道内部表结构、向量库或 prompt。官方来源：[Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)、[Dreaming: Better memory for a more helpful ChatGPT](https://openai.com/index/chatgpt-memory-dreaming/)。

## 2026 年的产品模型

旧系统包含两条路径：

- saved memories：用户明确要求记住，或聊天中触发保存；
- reference chat history：从历史聊天中提取上下文。

OpenAI 2026 年披露的新架构以 **dreaming** 为基础：后台过程持续综合过去对话，更新一个可用于新对话的 memory state。官方强调它会随时间修正状态，例如把“将去新加坡”演化成“2026 年 7 月去过新加坡”。

## 能确认的行为

- memory 是跨聊天的个性化上下文；
- 后台 synthesis 不要求用户每次明确说“记住”；
- memory summary 只展示高层视图，不保证列出所有内部上下文；
- 用户能刷新 summary、纠正信息、要求不要再提及；
- memory sources 可解释一次回答使用了哪些来源；
- Temporary Chat 不使用/不写入 memory；
- 删除聊天不等于删除独立保存的 memory；
- legacy saved memories 可单独管理，删除日志可能为安全/调试保留最多 30 天。

## 产品设计上真正值得学的部分

### 1. 记忆必须有可见表面

用户要能知道系统记住了什么、为什么使用、如何纠正。只在后端静默注入会把错误个性化变成不可诊断行为。

### 2. 来源与记忆分离

删除来源聊天和删除派生 memory 是不同动作，但 UI 必须解释清楚。对本项目意味着 `source_message_id` 不能省略。

### 3. 时间会主动改变语义

事实不只在新消息到达时变化。计划、地点、短期目标会自然过期，需要 `valid_from/valid_to` 或周期性 consolidation。

### 4. summary 不是完整记录

用户可见 summary 是控制面，不一定是数据库真相。若本项目也采用聚合画像，应同时允许展开来源事实，避免只提供不可核验的总括。

## 不应推断的内容

官方没有公开：

- 具体 embedding、数据库或检索 top-k；
- dreaming 的模型、触发频率、prompt 与成本；
- 冲突消解算法；
- memory summary 与实际注入 context 是否一一对应；
- 敏感信息分类器的完整规则。

因此不能把“ChatGPT 看起来能记住”翻译成某个可复制的源码架构。

## 对本项目的最小 UX 要求

在自动记忆默认开启前，至少提供：

1. memory summary/列表；
2. 每条来源与时间；
3. 编辑、删除、清空；
4. 临时聊天或关闭自动记忆；
5. 回答级“使用了哪些记忆”；
6. 明确区分“删除对话”和“删除派生记忆”。

## 判定

**重点借鉴控制面与后台持续综合，不把闭源行为当作实现证据。**
