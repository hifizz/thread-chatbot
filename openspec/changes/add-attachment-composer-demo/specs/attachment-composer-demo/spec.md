# attachment-composer-demo 附件输入演示

## ADDED Requirements

### Requirement: 独立的纯前端演示页面

系统 SHALL 提供一个可直接访问的 Attachment Composer Demo 页面，用于独立验证附件输入和展示。该页面 SHALL 使用本地 React 状态，不接入正式 ThreadChat 消息发送、数据库、附件上传、ingest 或 Project File 业务。页面 SHALL 在附件变化时执行 `console.log("attachments changed", nextAttachments)`，便于后续业务开发者观察完整数据。

#### Scenario: 打开演示页面

- **WHEN** 用户访问 Attachment Composer Demo 路由
- **THEN** 页面显示一个包含顶部附件区、普通 textarea、左下角 `+` 按钮的 Composer，且无需创建消息或发起附件业务请求

#### Scenario: 附件变化可观察

- **WHEN** 用户通过任意入口添加或删除附件
- **THEN** 页面更新附件列表，并在浏览器控制台输出最新的完整附件数组

### Requirement: 受控附件组件契约

`AttachmentComposerDemo` SHALL 采用受控契约：

```ts
export type DemoAttachmentSource = "picker" | "drop" | "paste"

export type DemoAttachment = {
  id: string
  file: File
  source: DemoAttachmentSource
}

export type AttachmentComposerDemoProps = {
  attachments: DemoAttachment[]
  onChange(nextAttachments: DemoAttachment[]): void
}
```

组件 SHALL 将传入的 `attachments` 视为事实源；所有添加和删除 SHALL 通过一个新的数组调用 `onChange`，不得原地修改传入数组。每次用户动作 SHALL 至多触发一次 `onChange`；一次加入多个文件时 SHALL 以一个完整数组一次性提交变化。

#### Scenario: 一次加入多个附件

- **WHEN** 当前已有 1 个附件，用户一次加入另外 3 个文件
- **THEN** `onChange` 被调用一次，参数包含原附件和按输入顺序追加的 3 个新附件

#### Scenario: 删除一个附件

- **WHEN** 用户删除中间的某个附件
- **THEN** `onChange` 被调用一次，只有目标 `id` 被移除，其余附件顺序保持不变

#### Scenario: 同名和重复文件

- **WHEN** 用户加入两个同名文件，或再次加入同一个文件
- **THEN** 系统为每次出现生成独立的 `crypto.randomUUID()`，全部保留且不执行去重

### Requirement: 多选文件选择入口

Composer 左下角 SHALL 提供一个可访问的 `+` 按钮。点击后 SHALL 代理打开隐藏的 `<input type="file" multiple>`；本 Demo SHALL 不设置业务 MIME 白名单。一次选择的所有文件 SHALL 以 `source: "picker"` 加入附件数组。处理完成后 SHALL 清空文件输入的 `value`，以便同一个文件可以再次触发 `change`。

#### Scenario: 一次选择多个文件

- **WHEN** 用户点击 `+` 并一次选择 3 个文件
- **THEN** 顶部按 FileList 顺序新增 3 个独立附件，三者的 `source` 均为 `picker`

#### Scenario: 再次选择相同文件

- **WHEN** 用户选择一个文件后，再次打开选择器并选择同一个文件
- **THEN** 第二次操作仍触发变化，并新增一个具有不同 `id` 的独立附件

### Requirement: 多文件拖拽入口

Composer SHALL 接收一次拖入的所有 `DataTransfer.files`，以 `source: "drop"` 追加到附件数组。`dragover` 和 `drop` SHALL 调用 `preventDefault()`，避免浏览器导航或直接打开文件。Composer SHALL 在有效文件拖入期间显示最小的 dragging 状态，并在离开或完成 Drop 后恢复。

#### Scenario: 拖入多个文件

- **WHEN** 用户将 4 个文件拖入 Composer 并释放
- **THEN** 页面不会导航到本地文件，顶部按 DataTransfer 顺序新增 4 个附件，并调用一次 `onChange`

#### Scenario: 拖拽状态结束

- **WHEN** 用户将文件拖入后移出 Composer，或完成 Drop
- **THEN** Composer 的 dragging 视觉状态被清除

### Requirement: 粘贴文件和图片

当 Composer 内发生 Paste 时，系统 SHALL 收集 `clipboardData.items` 中所有 `kind === "file"` 且可取得 `File` 的项，并以 `source: "paste"` 追加。只要本次 Clipboard 存在至少一个文件项，系统 SHALL `preventDefault()`，且本次只创建文件附件，不再为同一事件的 `text/plain` 创建重复文本附件。

#### Scenario: 粘贴截图

- **WHEN** 剪贴板包含一个图片 File item，用户在 Composer 中粘贴
- **THEN** 顶部新增一个图片附件，`source` 为 `paste`，图片数据不作为 base64 写入消息或发往服务端

#### Scenario: 混合 Clipboard 优先文件

- **WHEN** 同一次 Paste 同时包含 file item 和 `text/plain`
- **THEN** 只为所有 file item 创建附件，不创建 synthetic 文本附件

#### Scenario: 多个 Clipboard 文件

- **WHEN** Clipboard 向浏览器暴露多个可读取的 File item
- **THEN** 所有文件在一次 `onChange` 中按 Clipboard 顺序追加

### Requirement: 粘贴纯文本生成 synthetic 附件

当 Paste 不包含可读取的文件项时，系统 SHALL 读取 `text/plain`。非空且不全为空白的文本 SHALL 被包装为一个新的 `File`：文件名采用 `pasted-text-{timestamp}.txt` 或等价的可识别名称，MIME 类型为 `text/plain`，内容等于原始 Clipboard 文本，`source` 为 `paste`。系统 SHALL `preventDefault()`，使该文本不插入 textarea。空字符串或全空白文本 SHALL 不创建附件，也不触发 `onChange`。

#### Scenario: 粘贴普通长文本

- **WHEN** 用户粘贴一段非空文本且 Clipboard 无文件项
- **THEN** 顶部新增一个 `.txt` synthetic 附件，其 File 内容等于原文本，textarea 不包含该段粘贴文本

#### Scenario: 粘贴空白文本

- **WHEN** 用户粘贴的 `text/plain` 为空或全为空白
- **THEN** 不新增附件，也不调用 `onChange`

### Requirement: 顶部附件区与独立附件 Item

Attachment Tray SHALL 位于 textarea 上方。每个 `DemoAttachment` SHALL 对应一个独立、可单独删除的 Item，至少展示文件名、通用文件图标和移除按钮。Tray SHALL 单行排列且不换行；附件过多时 SHALL 在自身区域横向滚动，不得撑宽 Composer 或移动 textarea 与底部操作区。单个超长文件名 SHALL 在 Item 内截断，Item 本身 SHALL 不被 flex 压缩。

#### Scenario: 多附件横向滚动

- **WHEN** 附件数量或文件名总宽度超过 Composer 可用宽度
- **THEN** Tray 的 `scrollWidth` 大于 `clientWidth`、Item 仍保持单行，Composer 外层宽度保持稳定

#### Scenario: 单项移除

- **WHEN** 用户点击某个附件 Item 的移除按钮
- **THEN** 只移除该 Item，点击不会触发文件选择、发送或其他附件的删除

#### Scenario: 长文件名

- **WHEN** 一个文件名长于单个 Item 的最大展示宽度
- **THEN** 文件名在 Item 内截断，完整列表和 Composer 布局不溢出

### Requirement: 普通文本输入不受影响

Composer SHALL 继续提供普通 textarea。键盘逐字输入 SHALL 保留在 textarea 中，不创建附件。只有 Paste 事件按上述规则被转换为附件。本变更 SHALL 不修改正式 `ConversationComposer` 的 `onSend(text)` 行为，也不要求 Demo 发送按钮执行消息发送。

#### Scenario: 普通打字

- **WHEN** 用户在 textarea 中逐字输入普通 Prompt
- **THEN** 文本正常显示在 textarea，附件数组不变化

#### Scenario: 发送不属于 Demo

- **WHEN** 用户查看或点击 Demo 中可选的发送视觉控件
- **THEN** 系统不创建正式消息、不调用 `/api/chat`；发送控件可以省略或保持禁用状态

### Requirement: 零附件业务请求与零编辑器扩张

Demo 的添加、删除和展示 SHALL 全部在浏览器内完成。实现 SHALL NOT 调用 `fetch`、XHR、`/api/attachments`、R2/S3、ingest 或删除接口，SHALL NOT 使用 `lib/chat/attachment-adapter.ts`，并 SHALL NOT 新增 Lexical、Tiptap、ProseMirror 或其他编辑器依赖。页面刷新后附件可以丢失。

#### Scenario: 验证零附件请求

- **WHEN** 用户依次执行 Picker、Drop、Paste 和 Remove
- **THEN** Network 记录中不存在 `/api/attachments`、对象存储 PUT、ingest 或附件删除请求

#### Scenario: 刷新页面

- **WHEN** 用户添加附件后刷新 Demo 页面
- **THEN** 本地附件可以被清空，系统不尝试从数据库或浏览器持久层恢复
