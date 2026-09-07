## ADDED Requirements

### Requirement: 同 Project 的 Markdown 引用与服务端授权
系统 SHALL 允许同 Project 内任意 Thread 引用来源已 completed 的 Markdown Artifact，包括自身、父级、兄弟及深层分支；新引用 SHALL 只接收客户端 ID，并在目标所有权验证及既有事务内解析权威数据。

#### Scenario: 深层与自身引用
- **WHEN** 用户在拥有的 Project 中选择其他 Thread 或当前 Thread 的已完成 Markdown Artifact
- **THEN** 服务端保存 ID、版本及冻结来源元信息，不导入未引用 Thread 的整段历史

#### Scenario: 非法引用
- **WHEN** ID 不存在、属于其他 Project/用户、来源未完成或类型不支持
- **THEN** 在付费模型调用前拒绝且事务无半成品消息，客户端保留草稿

#### Scenario: 客户端伪造正文
- **WHEN** artifact-reference 输入携带客户端 title/content/source 等权威字段
- **THEN** 严格 Schema 拒绝该输入，不能覆盖服务端数据

### Requirement: 固定产物回放
系统 SHALL 保证同 Artifact ID 的标题、类型、正文和来源不可原地变更；内容更新使用新 ID，历史引用不得自动追随最新同名产物。

#### Scenario: 来源重新生成或归档
- **WHEN** 来源消息被新消息替代或来源 Thread 归档
- **THEN** 旧引用仍能回放原正文；在该 Project 存续时保留其引用目标

#### Scenario: 新建 Project
- **WHEN** 创建 Project 的首问引用其他 Project 产物
- **THEN** 拒绝该引用而不扩大权限范围

### Requirement: 实际上下文的单向展开
系统 SHALL 按实际选定消息和 Parts 顺序从前往后展开引用；只有前文包含完整且身份匹配的最终模型可见正文时才复用。

#### Scenario: 首次与重复引用
- **WHEN** 跨 Thread Artifact 首次出现，之后在同一条或后续消息重复提及
- **THEN** 首次展开全文，后续保留位置并使用固定 ID/冻结标题/previouslyIncludedInContext 标记

#### Scenario: 完整源工具已包含
- **WHEN** 自身或 forkContext 来源工具是最终 SDK 保留的完整正文且 ID、来源及内容匹配
- **THEN** 后续引用使用固定标记，不重复展开正文

#### Scenario: 来源被剔除或裁剪
- **WHEN** 来源不在实际历史、为临时或不完整工具、被 SDK 剔除或已裁剪
- **THEN** 首个存活引用补入全文，不以标题或 Thread 身份跳过

### Requirement: 编译前缀稳定
系统 SHALL 固定引用标记的字段顺序与内容，不加入轮次、时间、位置编号；不得因新增后文改写历史模型消息或持久化 Parts。

#### Scenario: 追加与重试
- **WHEN** 相同模型和其他请求配置下追加一条引用消息或重试相同输入
- **THEN** 引用编译产生的历史模型前缀保持字节一致，重试结果确定

### Requirement: 分层预算与可读失败
系统 SHALL 区分单消息接收限制和最终请求总预算。单消息最多 20 次 Artifact 提及，不同 Artifact 标题与正文合计最多 200,000 个 JavaScript 字符；整体预算 SHALL 在统一最终请求组装边界计入全部模型输入与输出预留，不静默截断。

#### Scenario: 单消息预算超限
- **WHEN** 一条消息超过提及次数或唯一正文字符限制
- **THEN** 拒绝并提示减少引用，不保存截断正文

#### Scenario: 多轮累计已知超限
- **WHEN** 最终请求计量已支持且含历史、附件、引用、system、工具及输出预留的总量超限
- **THEN** 在模型调用前返回可读的上下文超限错误，不反向删改旧消息

#### Scenario: 计量能力未知
- **WHEN** 某模型或多模态内容暂不能可靠预估 token
- **THEN** 内部结果明确标记 unknown，不能声称预算检查通过；提供商超限须转换成可读错误
