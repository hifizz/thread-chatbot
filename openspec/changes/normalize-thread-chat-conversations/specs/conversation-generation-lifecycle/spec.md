## Purpose

定义一次助手生成从创建到终态的可观察状态机，以及 Stop、Retry、断流、刷新和单进程重启时必须保持的数据一致性与恢复行为。

## ADDED Requirements

### Requirement: 生成任务独立于请求连接

发送、编辑、Retry 或 Regenerate 命令成功创建助手 Message 后，模型生成任务 SHALL 在服务端继续运行，直至完成、停止或失败；发起命令的 HTTP 响应、SSE 订阅或浏览器连接关闭 SHALL NOT 自动取消该任务。

#### Scenario: 用户在生成中关闭页面

- **WHEN** 助手 Message 正在生成且用户关闭页面或网络连接断开
- **THEN** 服务端任务继续执行并最终将该 Message 写入一个终态

### Requirement: 以条件终结保证单一终态

系统 SHALL 仅在 Message 当前为 `generating` 时把它终结为 `completed`、`stopped` 或 `failed`，并 SHALL 由生成任务的唯一终结路径写入最终 `parts[]`。重复或竞争的终结请求 SHALL 返回数据库现有结果，不得再次调用模型或覆盖终态。

#### Scenario: Stop 与完成同时发生

- **WHEN** Stop 请求与模型完成事件竞争
- **THEN** 恰有一个终态提交成功，另一方读取并返回已提交的 Message

### Requirement: Stop 只请求中止

Stop 命令 SHALL 对仍活跃的生成请求中止，并 SHALL NOT 直接伪造或覆盖最终 Message 内容。后台生成消费方 SHALL 根据协议结束信息把仍为 `generating` 的 Message 终结为 `stopped`；对终态 Message 的重复 Stop SHALL 幂等返回现有 Message。

#### Scenario: 连续点击停止

- **WHEN** 用户对同一活跃 Message 多次提交 Stop
- **THEN** 系统只请求一次有效中止，并最终返回同一条终态 Message

### Requirement: Retry 和 Regenerate 创建新尝试

Retry 或 Regenerate SHALL 为同一 Thread 创建新的助手 Message 和新的生成任务，并在同一事务中给旧终态 Message 设置 `superseded_at`。原 Message 的状态和内容 SHALL 保持不变；同一个命令 ID 重放 SHALL 返回已创建的新 Message。

#### Scenario: 失败后连续重试

- **WHEN** A 失败后 Retry 创建 B，而 B 也失败后用户再次以新命令 Retry
- **THEN** 系统创建 C，A 与 B 保留各自失败结果，且 B 被标记为已取代

#### Scenario: Retry 请求被网络层重放

- **WHEN** 相同命令 ID 的 Retry 请求被提交两次
- **THEN** 两次响应引用同一条新助手 Message，模型只启动一次

### Requirement: 断流和刷新以轮询收敛

客户端在 SSE 断开或页面刷新后 SHALL NOT 尝试续传或重放丢失的 chunk。系统 SHALL 允许客户端保留已接收快照、显示该 Message 仍在后台生成，并轮询权威 Message；当数据库进入终态时，客户端 SHALL 自动展示完整终态 `parts[]`。

#### Scenario: 生成中刷新页面

- **WHEN** 用户刷新时 Message 状态仍为 `generating`
- **THEN** 页面从数据库恢复生成状态并轮询，完成后自动替换为终态内容

### Requirement: 进程重启后收敛遗留生成

在单进程服务启动时，系统 SHALL 将不存在可恢复后台任务的陈旧 `generating` Message 条件更新为 `failed`，并保留已经持久化的内容快照。系统 SHALL NOT 假装恢复中断的模型流。

#### Scenario: 生成时 VPS 进程重启

- **WHEN** 服务重启后数据库仍有上一个进程留下的 `generating` Message
- **THEN** 该 Message 收敛为 `failed`，用户可通过新 Retry 命令创建新的 Message
