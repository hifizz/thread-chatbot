# Anthropic memory tool：文件协议与 JIT 读取

> 文档快照：2026-07-24。官方入口：[Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)。工具 `memory_20250818` 已 GA，但部分 SDK helper 仍位于 beta namespace。

## 设计动机

Anthropic 没有替开发者托管记忆。模型只发出文件操作请求，应用在自己控制的存储上执行，再以 `tool_result` 返回。`/memories` 是逻辑前缀，可以映射到本地目录、对象存储或数据库。

核心思路不是“每轮把所有记忆塞进 prompt”，而是：

```text
任务开始 -> view /memories
         -> view 相关文件/行
         -> 使用信息
         -> create/edit/rename/delete 持久化新进展
```

这是 just-in-time context retrieval，尤其适合长程任务和跨 session 恢复。

## 工具协议

请求只需声明：

```json
{ "type": "memory_20250818", "name": "memory" }
```

应用必须实现六个命令：

| command | 关键参数 | 语义 |
| --- | --- | --- |
| `view` | `path`, `view_range?` | 列目录或按 1-based 行号读文件 |
| `create` | `path`, `file_text` | 创建文件；官方 handler 对已存在路径报错 |
| `str_replace` | `path`, `old_str`, `new_str?` | 仅在旧文本唯一出现时替换 |
| `insert` | `path`, `insert_line`, `insert_text` | 在指定行后插入，0 表示文件头 |
| `delete` | `path` | 删除文件/目录，但不能删除根目录 |
| `rename` | `old_path`, `new_path` | 移动或改名，不覆盖已有目标 |

Python/TypeScript SDK 提供本地文件 helper；生产实现仍应替换为每用户隔离的持久存储。

## 为什么 `str_replace` 值得借鉴

它要求 `old_str` 唯一匹配，否则拒绝操作。这相当于一种面向文本的乐观并发控制：模型必须先读到精确旧值，才能修改。相比“整文件覆盖”，它减少误删与基于过期视图覆盖新内容的风险。

对结构化事实表，可映射成：

```text
update memory_facts
set value = :new, version = version + 1
where id = :id and version = :expected_version
```

## 安全边界

官方文档明确把安全责任交给应用：

- 所有路径必须位于 `/memories`；
- canonicalize 后再次验证根目录；
- 拒绝 `../`、`..\\` 和 URL-encoded traversal；
- 限制文件大小、单次 `view` 返回量与文件寿命；
- 不把敏感数据交给模型自行决定保存；
- 错误用 `tool_result.is_error=true` 返回，不能静默成功。

多租户实现还必须把逻辑路径绑定到已鉴权 `userId`，绝不能让模型输入决定真实租户目录。

## 与当前项目的映射

项目已有 AI SDK tool loop 和 `prepareStep`，可以用普通 `tool()` 模拟相同协议；但原生 Anthropic schema 只适用于 Claude provider。当前产品支持多模型，因此若采用，应定义 provider-neutral 的 `viewMemory/updateMemory` 工具，而不是把 `memory_20250818` 写死到主链路。

此外，Thread Chat 的主要对象是“关于用户的事实”，不是“agent 自己维护的项目文件”。对用户画像而言，文件缺少 predicate、来源和有效时间，不应成为主存储。

## 可复用点

- 存储完全由应用控制；
- 先读后写、精确替换、显式错误；
- 按需读取而非全量常驻；
- memory 与 compaction 分工：前者跨 session，后者压缩当前会话；
- 目录/文件可直接成为用户可查看的审计界面。

## 判定

**借鉴工具协议，不照搬文件模型。** 若阶段 4 增加“模型主动管理记忆”，应把可写动作限制为候选提议或带版本条件的 CRUD，并继续以 Postgres 事实表作为记录系统。
