## ADDED Requirements

### Requirement: 官方扩展方式与问题升级
输入框 SHALL 通过 Lexical 官方 Node、React Plugin、Command、序列化和 Typeahead 公开接口实现业务行为；MUST NOT 依赖私有 DOM 层级、内部定位覆盖或逐帧对抗官方定位的补丁。

#### Scenario: 官方机制可满足
- **WHEN** 现有公开接口支持引用节点、候选选择及发送
- **THEN** 复用官方行为并以职责拆分业务 Plugin，不引入自有编辑器抽象框架

#### Scenario: 官方能力不足
- **WHEN** 已确认交互无法通过当前版本公开接口实现
- **THEN** 提交最小复现、版本和官方能力依据并向用户求助，不自行新增内部补丁或删减需求

### Requirement: 原子引用和自然输入
输入框 SHALL 保留原有阅读风格，支持显式 @ 按钮、中文前缀触发、按标题/类型/来源 Thread 搜索、首项高亮及键盘选择；引用标题不得被当作普通文字编辑。

#### Scenario: 输入法与键盘连续输入
- **WHEN** 用户输入中文并确认候选，随后用上下键和 Enter 选择 Artifact
- **THEN** 输入法确认不误发送，菜单选择后可直接继续输入，Escape 可关闭菜单

#### Scenario: 删除撤销与剪贴板
- **WHEN** 用户跨过、删除、撤销或在应用内复制粘贴混排引用
- **THEN** 维持原子引用身份和顺序；普通邮箱及 @ 文本不被自动识别为业务引用

### Requirement: 草稿与编辑器的状态归属
Lexical SHALL 负责活动文档、选区与撤销栈；草稿 Store SHALL 按 Project/Thread 保存完整有序内容及上传状态，仅在显式加载/切换/重置时反向导入编辑器。

#### Scenario: 列与画布切换
- **WHEN** 同一 Thread 在列与画布之间切换，或其他 Thread 有独立草稿
- **THEN** 当前 Thread 内容和附件保留，不混入其他 Thread，已有 Part 顺序不变

#### Scenario: 迟到发送结果
- **WHEN** 发送后用户继续输入或切换 Thread，原发送成功或失败稍后返回
- **THEN** 成功仅清理匹配的提交快照，失败保留内容；新输入和其他 Thread 草稿不被覆盖

### Requirement: 资源订阅与历史导航独立
候选 SHALL 订阅已有资源 Store 的必要切片，历史展示 SHALL 使用明确导航能力而不依赖草稿 Provider；必需上下文缺失不得静默退化成替代 Store。

#### Scenario: 无关流式更新
- **WHEN** Artifact 数据未变且另一个 Thread 正在流式生成，当前菜单未打开
- **THEN** 不因该流式更新重新搜索排序候选

#### Scenario: 历史引用点击
- **WHEN** 在不挂载输入框草稿 Provider 的历史展示区域点击引用
- **THEN** 可通过明确回调打开对应固定 Artifact

### Requirement: 实际布局验收
输入框 SHALL 在底部输入、窄列、菜单长列表、画布缩放和平移、移动软键盘条件下保持候选可见可操作，菜单不得撑开页面。

#### Scenario: 边界与滚动
- **WHEN** 在上述场景打开菜单、滚动并选择候选
- **THEN** 菜单受可视区域约束，长列表内部滚动且键盘高亮项可见，页面不因菜单增加溢出
