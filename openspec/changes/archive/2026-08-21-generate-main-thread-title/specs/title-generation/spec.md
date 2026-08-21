## Purpose

为 MainThread 和 ForkedThread 生成一次完整、可持久化的语义标题；标题失败不影响对话，也不会在刷新后重复消耗模型配额。

## ADDED Requirements

### Requirement: 为目标 Thread 生成完整语义标题

系统 SHALL 为满足条件的 MainThread 或 ForkedThread 自动生成一次完整语义标题。MainThread SHALL 使用首条用户消息作为生成上下文；ForkedThread SHALL 使用其 Fork 锚点、首条用户问题和可渲染首答作为生成上下文。服务端不得按固定字符数或英文单词数截断成功生成的标题；前端可以仅为布局目的省略可见文本。

#### Scenario: MainThread 首条消息生成标题

- **WHEN** 用户在空 MainThread 提交首条非空消息
- **THEN** 系统异步生成并保存概括该消息主题的完整标题，且不阻断主回答

#### Scenario: ForkedThread 首轮问答生成标题

- **WHEN** ForkedThread 具有 Fork 锚点、首条用户问题和可渲染首答
- **THEN** 系统异步生成并保存概括该分叉讨论的完整标题

#### Scenario: 生成失败时回退

- **WHEN** 标题模型未配置、调用失败或未返回有效标题
- **THEN** 系统保留该 Thread 的既有回退标题且不阻断对话

### Requirement: 每个 Thread 最多自动尝试一次标题生成

系统 SHALL 在 MainThread 或 ForkedThread 的首次自动标题生成尝试开始时记录该 Thread 已尝试。无论模型调用成功、未配置或失败，后续页面刷新均不得再次自动请求；当前浏览器标签页在持久化写入完成前刷新时也 SHALL 避免重复请求。

#### Scenario: 刷新中的 MainThread 请求

- **WHEN** MainThread 首条消息已触发标题请求但整树状态尚未完成持久化，用户刷新页面
- **THEN** 系统不为该 MainThread 再次自动发起标题生成请求

#### Scenario: ForkedThread 配额错误

- **WHEN** ForkedThread 标题模型因配额不足或其他错误未返回标题
- **THEN** 该 ForkedThread 保留回退标题且不会自动重试

### Requirement: MainThread 标题投影与用户标题优先级

MainThread 成功生成的 Title SHALL 作为 Thread Tree 的机器标题保存。用户为 Thread Tree 设置的自定义 Title SHALL 在树级导航和 MainThread 列头展示中优先于自动 Title。

#### Scenario: 自动标题后重命名

- **WHEN** MainThread 已生成自动 Title，用户为其 Thread Tree 设置自定义 Title
- **THEN** 树级导航和 MainThread 列头展示用户自定义 Title，自动 Title 保留为机器派生标题
