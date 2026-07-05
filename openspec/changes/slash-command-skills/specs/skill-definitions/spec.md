# skill-definitions

## ADDED Requirements

### Requirement: Skill 以服务端文件定义
系统 SHALL 从项目根目录 `skills/<id>/SKILL.md` 加载 Skill 定义。每个 SKILL.md MUST 包含 YAML frontmatter（字段：`id`、`label`、`description`，可选 `icon`、`tools`）与 Markdown 正文（注入模型的 prompt 内容）。frontmatter 的 `id` MUST 与目录名一致，且为 kebab-case。

#### Scenario: 加载合法的 skill 定义
- **WHEN** `skills/translate/SKILL.md` 存在且 frontmatter 完整、`id` 为 `translate`
- **THEN** 加载器将其纳入注册表，元数据与正文均可按 `id` 查询

#### Scenario: 拒绝非法的 skill 定义
- **WHEN** 某个 SKILL.md 缺少必填 frontmatter 字段，或 `id` 与目录名不一致
- **THEN** 加载器跳过该 skill 并输出警告日志，不影响其余 skill 加载

### Requirement: 注册表缓存
加载器 SHALL 在模块级缓存注册表，同一进程内重复读取 MUST NOT 重复扫描文件系统。

#### Scenario: 重复请求命中缓存
- **WHEN** 同一进程内第二次请求 skill 列表
- **THEN** 直接返回缓存结果，不再读取磁盘

### Requirement: 元数据接口只暴露元数据
`GET /api/skills` SHALL 返回所有已注册 skill 的元数据数组（`id`、`label`、`description`、`icon`），且 MUST NOT 包含 prompt 正文与 `tools` 声明。

#### Scenario: 前端获取 skill 列表
- **WHEN** 前端请求 `GET /api/skills`
- **THEN** 收到 `200` 与元数据 JSON 数组，任何条目均不含正文字段

#### Scenario: 无可用 skill
- **WHEN** `skills/` 目录不存在或没有合法 skill
- **THEN** 接口返回 `200` 与空数组
