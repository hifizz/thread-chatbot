# skill-slash-command-ui

## ADDED Requirements

### Requirement: 斜杠触发 skill 选择菜单
当用户在 Composer 输入框中输入触发字符 `/` 时，系统 SHALL 弹出 skill 选择菜单，列出 `GET /api/skills` 返回的全部 skill（label、description、icon），并支持继续输入按名称过滤、键盘上下导航与回车选中。

#### Scenario: 输入斜杠弹出菜单
- **WHEN** 用户在输入框中输入 `/`
- **THEN** 输入框上方弹出 skill 菜单，展示全部可用 skill

#### Scenario: 继续输入过滤
- **WHEN** 菜单打开后用户继续输入 `tra`
- **THEN** 菜单只保留 label 或 id 匹配 `tra` 的 skill；无匹配时显示空状态文案

#### Scenario: 列表加载中
- **WHEN** skill 列表尚未从接口返回
- **THEN** 菜单显示加载中文案，不显示误导性的"无可用项"

### Requirement: 选中后以 directive 形式插入输入框
用户选中某个 skill 后，系统 SHALL 将其序列化为 directive 文本 `:skill[<label>]{name=<id>}` 替换输入框中的触发文本，用户 MUST 能在其后继续输入自由文本作为该 skill 的输入参数。

#### Scenario: 选中 skill
- **WHEN** 用户在菜单中选中"翻译"（id 为 `translate`）
- **THEN** 输入框中的 `/…` 触发文本被替换为 `:skill[翻译]{name=translate} `，光标位于其后可继续输入

### Requirement: 消息中的 directive 渲染为 chip
用户消息文本中的 `:skill[label]{name=id}` 语法 SHALL 渲染为带图标的 chip 徽章而非原始文本；该渲染 MUST 对从数据库重新加载的历史消息同样生效。

#### Scenario: 发送后渲染 chip
- **WHEN** 用户发送含 skill directive 的消息
- **THEN** 消息气泡中该 directive 显示为 chip，其余文本正常显示

#### Scenario: 刷新后历史回显
- **WHEN** 页面刷新、线程历史从 Postgres 重新加载
- **THEN** 历史 user message 中的 directive 仍渲染为 chip
