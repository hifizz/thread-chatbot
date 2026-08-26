## Purpose

定义单实例部署中进程内 Stream Session 对后台 AI 任务、完整 UI Message 快照、实时增量订阅和有限生命周期缓存的可靠性契约。

## ADDED Requirements

### Requirement: 每个生成消息至多有一个活跃 Session

每条 `generating` 助手 Message SHALL 至多对应一个进程内活跃 Stream Session。Session SHALL 拥有该次模型任务、取消能力、当前完整 UI Message 快照、终态信息和订阅者集合；Session 的存在不得依赖任何单一 HTTP 请求对象。

#### Scenario: 重复连接同一生成流

- **WHEN** 两个订阅请求同时连接同一条活跃助手 Message
- **THEN** 两者订阅同一个 Session，且不会启动第二次模型调用

### Requirement: 订阅先注册再发送快照

新订阅 SHALL 先原子注册到 Session，再收到当前完整 UI Message 快照，之后收到该 Session 产生的标准 UI Message chunks。系统 SHALL 保证订阅注册与快照读取之间产生的增量不会永久丢失。

#### Scenario: 快照读取时恰有新 chunk

- **WHEN** 新订阅建立期间模型恰好产生一个增量
- **THEN** 订阅者通过快照或后续 chunk 至少观察到该增量一次，并可按协议幂等归并

### Requirement: 传输完整 UI Message 协议

Session SHALL 从模型流构建并维护 AI SDK v7 或更高版本的 UI Message，并向订阅者传输可由该协议消费的 chunks。传输 SHALL 保留 text delta 标识、reasoning、source、file、tool 和 data parts，不得将所有事件压扁为纯文本。

#### Scenario: 工具执行产生多阶段事件

- **WHEN** 模型先产生工具输入、再产生工具结果和正文
- **THEN** 订阅者能够按 UI Message 协议观察并构建所有对应 parts

### Requirement: 订阅断开不终止 Session

任一订阅断开 SHALL 只移除该订阅者，不得取消模型任务。Session SHALL 允许零订阅者时继续生成并完成持久化。

#### Scenario: 最后一个订阅者断开

- **WHEN** 活跃 Session 的最后一个 SSE 客户端断开
- **THEN** Session 继续消费模型流并写入终态

### Requirement: 结束后的 Session 有界保留

Session 在进入终态后 SHALL 记录结束时间并在一个有界宽限期内保留最终快照，以处理迟到订阅和重复请求；超过宽限期且无订阅者时 SHALL 被清理。清理周期 SHALL 不因比较错误而删除活跃 Session 或永久保留终态 Session。

#### Scenario: 终态后立即订阅

- **WHEN** 客户端在 Message 完成后、清理宽限期内建立订阅
- **THEN** 系统返回最终快照和终态，而不重新启动模型

#### Scenario: 终态 Session 到期

- **WHEN** Session 已结束超过宽限期且没有订阅者
- **THEN** 系统从内存移除 Session，数据库 Message 仍可正常读取
