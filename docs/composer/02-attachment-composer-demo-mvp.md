# Attachment Composer Frontend Demo MVP

> 状态：**当前进入 Spec / Design 的冻结范围**  
> 关联需求：[Issue #68](https://github.com/hifizz/thread-chatbot/issues/68)  
> 代码基线：`codex/research-project-workspace-design`  
> 基线提交：`d4025739348d8b22f47e12d60ce455bb290da23b`  
> 完整背景与长期路线：[Composer Interaction System 完整调研](./01-composer-interaction-system-research.md)

---

## 0. 一句话目标

交付一个**纯前端、无后端依赖**的 Attachment Composer Demo：用户可以通过左下角 `+`、拖拽或粘贴加入多个文件/图片/文本附件，每个附件在输入框顶部独立回显，过多时横向滚动，所有变化通过 `onChange` 输出并在 Demo 中 `console.log`。

本 MVP 不实现真实上传、解析、消息发送、`@Artifact`、Quote、Slash、Skill 或结构化编辑器。

---

## 一、用户可见行为

### 1.1 Composer 结构

```text
┌──────────────────────────────────────────────────┐
│ [需求文档.pdf ×] [截图.png ×] [pasted-text.txt ×] → │
├──────────────────────────────────────────────────┤
│ 输入普通 Prompt……                                │
│                                                  │
│ [+]                                        [发送] │
└──────────────────────────────────────────────────┘
```

规则：

- Attachment Tray 位于文本输入框上方；
- 每个附件是一个独立、可移除的 Tile/Chip；
- Item 必须保持单行排列，不自动换行；
- 超出容器宽度后支持横向滚动；
- exact 圆角、胶囊或方形 Tile 不作为验收阻塞，优先沿用现有 assistant-ui Attachment 样式；
- 普通键盘输入仍然进入 textarea；
- Paste 行为按本文件定义统一转附件。

### 1.2 添加入口一：左下角 `+`

```text
点击 +
→ 打开系统文件选择器
→ 用户可一次选择多个文件
→ 所有文件加入 Attachment Tray
→ onChange(nextAttachments)
```

必须使用 `multiple`：

```html
<input type="file" multiple />
```

本期不设置业务 MIME 白名单；Demo 应允许系统选择器返回任意文件类型。

选择完成后，应清空隐藏 input 的 `value`，确保用户可以再次选择同一个文件并触发 `change`。

### 1.3 添加入口二：Drag & Drop

```text
拖入一个或多个文件
→ Composer 显示简单 dragging 状态
→ Drop 时读取全部 DataTransfer.files
→ 所有文件加入 Attachment Tray
→ onChange(nextAttachments)
```

要求：

- `dragover` 必须 `preventDefault()`，否则浏览器可能直接打开文件；
- 一次 Drop 的多个文件全部接收；
- Drop 后结束 dragging 状态；
- 不读取目录；目录拖拽不是本期能力；
- 不执行真实上传。

### 1.4 添加入口三：Paste File / Image

```text
剪贴板包含 File 或 Image item
→ 读取所有文件项
→ 每个文件项创建一个 DemoAttachment
→ onChange(nextAttachments)
```

常见场景：

- 截图后粘贴；
- 从 Finder/Explorer 复制文件后粘贴；
- 从其他应用复制可被浏览器暴露为 File 的内容。

浏览器没有可靠文件名时，可以保留浏览器提供的 `File.name`；如果为空，由 Demo 生成一个只用于展示的名称。

### 1.5 添加入口四：Paste Plain Text

用户复制普通文本或长内容后在 Composer 内粘贴：

```text
Clipboard 不包含 file item
+ text/plain 非空
→ preventDefault()
→ 创建 synthetic text File
→ 作为 Attachment 显示
→ 文本不插入 textarea
→ onChange(nextAttachments)
```

推荐：

```ts
const file = new File(
  [pastedText],
  `pasted-text-${Date.now()}.txt`,
  { type: "text/plain" },
)
```

空字符串或只有空白字符的文本不创建附件。

### 1.6 混合 Clipboard 的确定规则

同一次剪贴板事件可能同时暴露 HTML、plain text 和 file item。为防止重复创建：

1. 先读取所有 file item；
2. 只要存在 file item，本次只创建 File Attachment；
3. 没有 file item 时，才读取 `text/plain` 并创建 synthetic text File；
4. 本期不读取或保存 HTML 样式。

---

## 二、冻结的数据模型

### 2.1 Demo 数据结构

```ts
export type DemoAttachmentSource = "picker" | "drop" | "paste"

export type DemoAttachment = {
  id: string
  file: File
  source: DemoAttachmentSource
}
```

字段语义：

| 字段 | 语义 |
|---|---|
| `id` | 本次浏览器 Demo 中一次附件出现的唯一身份 |
| `file` | 浏览器原始 `File`；Paste Text 使用 synthetic `File` |
| `source` | 用户通过 picker、drop 或 paste 加入 |

### 2.2 ID 规则

每次加入都生成：

```ts
crypto.randomUUID()
```

不得使用文件名作为 key。用户可以添加两个同名文件，也可以重复添加同一个文件；本期默认不去重。

### 2.3 模型边界

该数据结构只属于浏览器 Demo：

- `File` 不可作为长期持久化协议；
- 不包含 server attachment id；
- 不包含上传状态；
- 不包含 URL；
- 不包含 Project/File membership；
- 不直接进入 Message Parts；
- 页面刷新后可以丢失。

未来真实业务必须在独立 Spec 中建立服务端 Attachment 模型。

---

## 三、组件契约

### 3.1 推荐的受控契约

```ts
export type AttachmentComposerDemoProps = {
  attachments: DemoAttachment[]
  onChange(nextAttachments: DemoAttachment[]): void
}
```

Demo 页面由父组件持有状态：

```ts
const [attachments, setAttachments] = useState<DemoAttachment[]>([])

const handleChange = (next: DemoAttachment[]) => {
  setAttachments(next)
  console.log("attachments changed", next)
}
```

所有变化只通过同一个 `onChange` 发出：

- Picker 添加；
- Drop 添加；
- Paste File/Image 添加；
- Paste Text 添加；
- 移除一个附件。

### 3.2 更新规则

添加：

```text
next = [...current, ...newAttachments]
```

移除：

```text
next = current.filter(item => item.id !== removedId)
```

不得原地修改传入数组。

### 3.3 Demo 输出

本期业务输出只要求：

```ts
console.log("attachments changed", nextAttachments)
```

可以同时在 Demo 页面显示简单调试信息，如附件数量，但不是必需验收项。

---

## 四、assistant-ui 复用边界

### 4.1 优先复用的现有代码

仓库已有：

- [`components/assistant-ui/attachment.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/components/assistant-ui/attachment.tsx)
- [`components/assistant-ui/thread.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/components/assistant-ui/thread.tsx)

已经包含：

- `ComposerPrimitive.AttachmentDropzone`；
- `ComposerPrimitive.AddAttachment`；
- `ComposerPrimitive.Attachments`；
- `AttachmentPrimitive.Remove`；
- 顶部附件区；
- 加号按钮；
- 每项单独展示；
- `overflow-x-auto`；
- 文件/图片视觉；
- Tooltip 和移除按钮。

Spec 应优先复用这些 Primitive、视觉和布局，不重新设计一套 Composer。

### 4.2 推荐实现路径

推荐建立一个 Demo-only Wrapper：

```text
AttachmentComposerDemo
├── assistant-ui Composer shell / input / dropzone
├── local demo attachment adapter or local controlled bridge
├── existing attachment tile/chip presentation
├── hidden input[type=file][multiple]
└── onChange bridge
```

原则：

- 复用 assistant-ui 的交互外壳和附件展示；
- Demo Attachment 的事实源仍是 `DemoAttachment[]`；
- adapter/bridge 只在浏览器内创建和移除对象；
- 不调用任何 API；
- 不将 assistant-ui Runtime 的内部对象暴露为业务契约。

若直接使用现有 `AttachmentPrimitive` 需要一个 Adapter，应创建 `demoAttachmentAdapter`，其 `add/send/remove` 均只处理本地对象并触发 `onChange`，不得包含 `fetch`、XHR 或 server id。

### 4.3 明确禁止复用的业务代码

不得将以下真实业务 Adapter 接到 Demo：

- [`lib/chat/attachment-adapter.ts`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/lib/chat/attachment-adapter.ts)

原因：它会执行真实 `/api/attachments`、R2 PUT、ingest 和删除请求。

### 4.4 当前 ThreadChat textarea

当前自定义 Composer：

- [`app/thread-chat/chat/composer/conversation-composer.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/app/thread-chat/chat/composer/conversation-composer.tsx)

本 MVP 不要求替换它的 Editor Core，也不要求重构 `onSend(text)`。

为避免影响生产消息链路，推荐先通过独立 Demo Route/Harness 验收组件；研究文档确认后，再由后续 Spec 决定是否将同一组件接入正式 ThreadChat Composer。

推荐的实现落点：

```text
app/thread-chat/attachment-composer-demo/page.tsx
app/thread-chat/chat/composer/attachment-composer-demo.tsx
```

其中 Page 只负责本地 state 和 `console.log`，可复用组件不包含业务 API。

---

## 五、UI 与布局要求

### 5.1 Attachment Tray

必须满足等价样式：

```css
display: flex;
flex-direction: row;
flex-wrap: nowrap;
gap: 0.5rem;
overflow-x: auto;
overflow-y: hidden;
```

每个 Attachment Item：

```css
flex: none;
```

要求：

- 不换行；
- 附件数量多时 Composer 总宽度不被撑开；
- 横向滚动时 textarea 和底部操作区保持原位；
- 文件名过长时单项内部截断；
- 每个 Item 都能单独移除。

已有 `ComposerAttachments` 已使用 `flex ... overflow-x-auto`，优先沿用。

### 5.2 加号按钮

- 位于 Composer 左下角；
- 使用现有 assistant-ui `ComposerAddAttachment` 或一致的 `TooltipIconButton`；
- `aria-label="Add attachment"`；
- 点击代理到隐藏 multi-file input；
- 不显示原始 `<input type=file>`。

### 5.3 Drag 状态

只要求最小反馈：

- 边框变为 dashed 或改变背景；
- Drop/Leave 后恢复；
- 不要求动画、Overlay 文案或精细 Drop Zone。

### 5.4 Attachment Item

最低展示：

- 文件名；
- 文件类型通用图标；
- 移除按钮。

可选但不要求：

- 文件大小；
- 图片缩略图；
- Tooltip；
- Source 标签。

如果复用现有 assistant-ui Tile 已自带图片预览，可以保留；若创建 `URL.createObjectURL()`，组件卸载或文件变化时必须 `URL.revokeObjectURL()`。

---

## 六、事件处理要求

### 6.1 Picker

```text
input.change
→ Array.from(input.files ?? [])
→ 每个 File 归一化
→ append
→ onChange
→ input.value = ""
```

### 6.2 Drop

```text
dragenter / dragover
→ preventDefault
→ setDragging(true)

dragleave
→ 仅在真正离开 Dropzone 时 setDragging(false)

drop
→ preventDefault
→ setDragging(false)
→ Array.from(dataTransfer.files)
→ append
→ onChange
```

### 6.3 Paste

```text
paste
→ 收集 clipboardData.items 中 kind === "file" 的全部 File
→ 若 file.length > 0：preventDefault + append files
→ 否则读取 text/plain
→ text.trim() 非空：preventDefault + synthetic File + append
```

Paste Handler 应挂在 Composer 可聚焦区域，使 textarea 聚焦时也能捕获事件。

### 6.4 Remove

```text
click remove(id)
→ filter
→ onChange(next)
```

移除不得触发 Composer 发送或重新打开文件选择器。

---

## 七、验收标准

全部满足才算 MVP 完成：

1. Composer 左下角存在 `+` 按钮。
2. 点击 `+` 可以打开系统文件选择器。
3. 文件选择器支持一次选择多个文件。
4. 可以一次拖入多个文件，浏览器不会导航到文件。
5. 可以粘贴图片或剪贴板文件，并形成独立附件。
6. 粘贴非空纯文本时创建 `.txt` synthetic attachment，文本不进入 textarea。
7. 每个附件在 Composer 顶部显示为独立 Item，并可单独移除。
8. 附件过多时保持单行，支持横向滚动，不撑破 Composer。
9. Picker、Drop、Paste、Remove 后都调用 `onChange(nextAttachments)`。
10. Demo 的 `onChange` 调用 `console.log`，能够查看完整数组。
11. 普通键盘输入仍可在 textarea 中输入，不被转成附件。
12. Demo 页面运行期间，Network 面板不出现附件上传、ingest 或删除 API 请求。
13. 不新增 Lexical、Tiptap、ProseMirror 等编辑器依赖。
14. TypeScript、Lint 和项目 Build 不因 Demo 代码报错。

---

## 八、必须覆盖的手工/自动测试场景

| 场景 | 预期 |
|---|---|
| Picker 选择 1 个文件 | 顶部出现 1 个 Item；onChange 长度 1 |
| Picker 一次选择 3 个文件 | 顶部出现 3 个 Item；顺序与 FileList 一致 |
| 再次选择同一个文件 | 新增一个独立 Item；不会因 input value 未清空而无响应 |
| 两个同名文件 | 两个不同 `id`，都显示 |
| Drop 4 个文件 | 全部加入；页面不打开文件 |
| 粘贴截图 | 出现 image attachment |
| 粘贴普通文本 | 出现 synthetic `.txt`；textarea 原值不被插入该文本 |
| 粘贴空白 | 不新增附件 |
| Clipboard 同时有 file 与 text | 只创建 file attachments，避免重复 |
| 删除中间一个附件 | 只删除目标 Item；其他顺序不变 |
| 加入 10+ 个文件 | Tray 横向滚动；Composer 宽度稳定 |
| 普通打字 | 正常进入 textarea |
| 查看 Network | 没有 attachment API 请求 |

建议自动测试使用 React Testing Library 覆盖状态与 `onChange`，Playwright 覆盖横向溢出和浏览器 Paste/Drop；本期不需要数据库测试。

---

## 九、Non-goals

以下任何一项进入当前 Spec 都属于范围扩大，必须另行确认：

- 真实文件上传；
- R2/S3；
- Presigned URL；
- ingest；
- 上传进度；
- 上传失败重试；
- 文件大小/MIME 业务校验；
- OCR、PDF、Office、Markdown、代码解析；
- 模型是否支持图片/文件的判断；
- 发送消息或修改现有 `onSend(text)`；
- 数据库；
- Attachment 持久化；
- 刷新恢复；
- Project File；
- `@Artifact`；
- Multi-quote / Quote Bundle；
- Slash Command / Skill；
- Lexical/Tiptap；
- 完整移动端体验；
- UI 像素级还原；
- 拖拽排序；
- 文件去重；
- 文件预览编辑。

---

## 十、建议实现顺序

1. 创建独立 Demo Route 与受控 `AttachmentComposerDemo`。
2. 定义 `DemoAttachmentSource` / `DemoAttachment`。
3. 复用 assistant-ui Composer Shell、顶部 Attachment 区和加号视觉。
4. 实现 `emitChange(next)` 单一更新入口。
5. 实现 Picker + `multiple` + input reset。
6. 实现 Drop 多文件。
7. 实现 Paste File/Image。
8. 实现 Paste Text → synthetic File。
9. 实现单项 Remove。
10. 验证横向滚动与长文件名。
11. 在父 Demo 中 `console.log`。
12. 通过 Network 面板确认零后端请求。
13. 运行 TypeScript、Lint、Build 与最小组件测试。

---

## 十一、Spec / Design 阶段的固定起点

下一阶段不需要重新讨论以下事项：

- 本期只做前端 Demo；
- 使用普通 textarea；
- 每个附件独立显示；
- Attachment Tray 单行横向滚动；
- 支持 picker multi-select、drop、paste file/image、paste text；
- Paste Text 转 synthetic `File`；
- 使用 `DemoAttachment { id, file, source }`；
- 使用受控 `attachments/onChange` 契约；
- 尽可能复用 assistant-ui；
- 不接 `r2AttachmentAdapter`；
- 不接任何后端；
- 不做 `@Artifact`、Quote、Slash、Skill 或结构化编辑器。

Spec 需要做的是把以上已冻结要求映射为组件、文件、任务和测试，不重新扩大产品范围。

---

## 十二、完成后的交付物

实现阶段应交付：

- 一个可直接访问的 Attachment Composer Demo 页面；
- 一个可复用的 Demo Composer 组件；
- `DemoAttachment` 类型；
- `onChange` + `console.log` 示例；
- Picker/Drop/Paste/Remove 行为；
- 横向滚动的独立附件 Item；
- 最小测试；
- 无后端请求的验收证据。

用户确认 Demo 与本 Research 文档后，再拆分真实 Attachment、`@Artifact` 或完整 Composer 的后续 Feature。