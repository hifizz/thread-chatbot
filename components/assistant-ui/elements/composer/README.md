# 项目 Composer 组件

基于 Assistant UI 官方提交 `98010f17b4a8d4bc506a6084007ecdaf4a823503` 的 Composer Demo 适配。`upstream.json` 仅记录迁入时的原始来源与校验值，当前模块已经拆分，不再要求与上游逐字一致。

- `layout.tsx`：外壳、工具栏、附件入口与发送按钮。
- `menu.tsx`、`models.tsx`：菜单项、Slash/人物匹配与模型展示。
- `attachments.tsx`：附件状态展示；上传由 Thread 业务层管理。
- `voice.tsx`、`context.tsx`、`mobile.tsx`：保留供后续接入的受控界面，不调用服务或提供演示数据。
- `theme.tsx` / `theme.module.css`：公共外观；宿主尺寸和留白由 Thread 模块持有。

正式入口在 `app/thread-chat/chat/composer/conversation-composer.tsx`。Lexical 负责有序文本与引用胶囊，附件队列负责真实上传；消息协议不依赖编辑器状态。独立官网 Demo、固定人物/模型/附件、固定转录与用量、模拟发送已移除。Slash、语音与用量尚未接入业务，不能视为已上线功能。
