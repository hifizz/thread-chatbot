## Why
先建立可扩展的管理后台入口，控制首次改动范围。动态模型配置暂缓。

## What Changes
- 从 PR #118 提取 sidebar-08 后台外壳，提供 `/admin` 静态样板页。
- 增加管理员成员表、服务端权限校验及已有账号授权脚本。
- 独立新分支提交 PR，目标为 `admin`；不合入 PR #118 的模型目录、缓存及聊天改动。

## Capabilities
### New Capabilities
- `admin-shell`: 后台框架、样板页与管理员门禁。

## Impact
既有源码仅增加数据库表导出和授权命令。新增功能集中于后台目录；不引入新依赖。正式 migration 按仓库规范在 develop 集成时生成验证。
