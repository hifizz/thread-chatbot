## ADDED Requirements

### Requirement: 首次使用提示

系统 SHALL 在主会话尚无消息且用户尚未关闭提示时，于列视图主会话顶部展示首次使用提示。用户关闭提示或主会话产生首条消息后，该内联提示 SHALL 消失。

#### Scenario: 空白新对话显示首次提示

- **WHEN** 用户打开主会话尚无消息且未关闭过提示的新对话
- **THEN** 系统在列视图主会话顶部展示使用提示卡片

#### Scenario: 首次提示关闭

- **WHEN** 用户关闭内联提示或发出主会话首条消息
- **THEN** 内联提示消失，顶栏“使用提示”按钮可用于随时重新查看内容

### Requirement: 手动 Help Dialog

系统 SHALL 在用户点击顶栏 `title="使用提示"` 的按钮时打开居中的 Help Dialog。Dialog SHALL 在列视图和画布视图中均可见，且 SHALL 不改变当前视图、会话、滚动位置或首次提示关闭状态。

#### Scenario: 列视图打开帮助

- **WHEN** 用户在列视图任意滚动位置点击“使用提示”按钮
- **THEN** 系统在当前视口居中显示 Help Dialog

#### Scenario: 画布视图打开帮助

- **WHEN** 用户在画布视图点击“使用提示”按钮
- **THEN** 系统在画布上方居中显示 Help Dialog，且不切换回列视图

### Requirement: Help Dialog 关闭行为

Help Dialog SHALL 复用现有会话树/对话列表的 Base UI Dialog 交互：挂载到 `.tc` Portal、显示遮罩及进退场动画，并支持点击遮罩或按 Escape 关闭。Escape SHALL 接入壳层逐层关闭链，一次按键不得连带关闭多个弹层。

#### Scenario: 点击遮罩关闭

- **WHEN** Help Dialog 打开且用户点击遮罩
- **THEN** Dialog 播放退场动画并卸载

#### Scenario: Escape 关闭

- **WHEN** Help Dialog 是当前最外层弹层且用户按 Escape
- **THEN** 系统只关闭 Help Dialog，不同时关闭其他面板或抽屉

### Requirement: 提示内容一致性

首次内联提示与 Help Dialog SHALL 复用同一个提示内容组件或数据来源，确保两处功能要点一致。

#### Scenario: 两种入口展示相同内容

- **WHEN** 用户分别查看首次内联提示和 Help Dialog
- **THEN** 两处展示相同的使用提示要点，仅外壳和关闭控件不同
