# Normalized UI parity verification

阶段 8 的实现态使用与基线相同的 Ego Browser task space、专用测试账号和
`1674 × 963` viewport 验证。测试数据位于隔离的 `thread-chat-test` PostgreSQL，
Project、Thread、Message、MessageRun 与 Artifact 全部来自新规范化表；页面没有读取或
写入旧 `branch_trees`。

## Screenshots

| Screenshot | State |
| --- | --- |
| `empty-new-normalized.png` | `/thread-chat/new` 无实体草稿；关闭一次性帮助后与空白基线同态 |
| `three-columns-normalized.png` | Root、第一层 Branch、嵌套 Branch 三栏完成独立 Message Query |
| `artifact-drawer-normalized.png` | Artifact 按 `artifactId` 加载完成后的 50% Drawer |

## Ego Browser interaction results

- `/new` 保持单个 Main Column、Header、Composer、Project List，并可在空实体状态切换
  Columns/Canvas；首次提交前没有伪造 Project、Thread 或 Message ID。
- Root 脚注打开第一层 Branch，Branch 脚注打开嵌套 Branch；三栏在精确基线 viewport
  下恢复为 `558.33 / 558.34 / 557.34px` 的原组件布局。
- Header Child 选择器同时显示直接与嵌套后代；Thread 切换到已在另一 Slot 打开的目标时
  交换两个 Slot 的 Thread 内容，Slot 宽度和物理位置不变。
- Breadcrumb 回到已经打开的上游 Thread 时关闭当前重复 Slot；“收起”继续删除对应 Slot。
- 第一条分割线向右拖动 `110px` 时只改变相邻两列，第三列不变；双击后三个列宽恢复自动
  均分，Snapshot 中 Root/Branch 宽度恢复 `null`。
- 强制两列并选择 `fold` 后打开嵌套 Branch，来源 Branch 原地折叠为细条；Snapshot 保存
  `folded=true`，刷新后恢复。
- Project-scoped Snapshot 恢复多栏、稳定 Slot、焦点、列宽、placement 和 view mode；
  Drawer、滚动位置和 Composer 草稿不进入 Snapshot。
- Artifact 卡片先建立 `artifactId` 引用，再由独立 loader 请求正文；完成态 Drawer 的
  `x=837px`、`width=837px` 与基线一致，并正确显示来源 Thread 和 Markdown 正文。
- Root assistant 文本选择可打开既有 Fork Composer；queued/running/failed assistant 仍禁止
  Fork，服务端命令继续执行最终校验。
- Project Catalog 来自 `/api/v1/projects`，显示当前 Project、Branch 数、重命名与删除入口。

未发现需要批准的最终样式、页面布局、多栏、Header、Fork、breadcrumb、Drawer 或分割线
交互变化。新增的 Project loading 与 Artifact loading/error 仅出现在规范要求的异步状态。
