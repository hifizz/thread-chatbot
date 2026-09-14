本清单描述后续功能实施；本次仅编写 OpenSpec，以下任务均未执行。文档就绪不代表功能已实现或数据库可发布。

## 1. 契约与选区文本基础

- [ ] 1.1 复核实施基线及引用相关 change 的归档状态；保留正文 Fork、Quote 删除、固定 Artifact ID 和冻结历史合同，确认本期父节点固定为 Artifact 来源 Thread。
- [ ] 1.2 定义共享 message/artifact 来源类型与 Fork target Schema；沿用现有 firstTurn/Parts 类型，规范化旧 anchorText/anchor 请求，拒绝混合歧义字段和客户端权威全文。
- [ ] 1.3 建立 Markdown 可选文本的纯函数规则与前后端固定样例，覆盖格式、链接、列表、表格、代码、换行、中文/emoji、重复原文和排除的界面文字；不支持区域明确拒绝。

## 2. 数据字段与回放链路

- [ ] 2.1 在 Schema 源码增加 nullable forkArtifactId、外键、根节点约束及项目内查询索引；在独立数据库用 db:push 验证，功能分支不生成或修改 drizzle migration。
- [ ] 2.2 补齐 Thread DTO、repository mapper、客户端 store 与视图适配；旧记录读为 null，Artifact 分支不错误绘制为消息正文分支。
- [ ] 2.3 覆盖来源在项目刷新、分支树、导出和现有分享序列化中的保留；验证被引用 Artifact 不能被单独删除，项目整体删除依赖顺序正常。

## 3. 分支命令与 Quote 校验

- [ ] 3.1 扩展 fork-thread 服务：沿用现有锁顺序/幂等事务，验证 Project 所有权、归档状态、Markdown/completed、有效时间线、父 Thread 和 Message 来源一致性。
- [ ] 3.2 集成 Artifact Anchor 验证，先位置后原文/上下文消歧；无匹配、歧义和超限明确拒绝，不用 fuzzy 授权，不改变已接受 exact。
- [ ] 3.3 持久化 forkArtifactId 及既有锚点、脚注和 forkContext；带问请求原子创建消息，留空只建 Thread，事务外沿用既有生成启动。
- [ ] 3.4 扩展 frozenFirstQuote 及首次发送校验，支持精确匹配 Fork 的 Artifact Quote；验证发送前删除、编辑删除、替代消息与无 Quote 分支，保持普通跨 Thread Quote 限制。
- [ ] 3.5 验证重复 commandId 同请求返回同一结果、异请求拒绝、无半成品写入且不重复生成；覆盖请求成功但响应丢失后的恢复。

## 4. 模型上下文

- [ ] 4.1 核对最终 SDK 模型消息中来源 Artifact 全文是否保留；在统一来源消息序列化边界补齐缺失正文，保持固定顺序和身份，不按子分支选区重写共同历史。
- [ ] 4.2 接通现有引用去重与统一预算，覆盖全文已含、工具仅 ID/标题、不完整/被 SDK 剔除、再次 @artifact、已知超限及 unknown 计量情况。
- [ ] 4.3 验证选区只从实际 Quote Parts 编译，删除后不从 Thread 锚点补回；覆盖 Artifact-only、空分支刷新后首问、后代分支、重试及来源 superseded 后回放。
- [ ] 4.4 比较两个同历史不同 Quote 的实际模型请求，确认共同历史前缀保持一致，无 Child 专属截断或隐藏选区提示。

## 5. 阅读组件与划选交互

- [ ] 5.1 从生产 ProjectPanel 抽出 ArtifactDetail，保留复制、来源、标题与阅读能力；新增轻量 SelectionSurface，MarkdownBody 保持纯渲染职责。
- [ ] 5.2 在唯一 useAssistantTextSelection 入口抽出来源解析，支持 message/artifact 联合 SelectionInfo；适配滚动根、跨根选区拒绝及监听清理，不按阅读实例新增 document 监听器。
- [ ] 5.3 扩展 SelectionBubble/Toolbar/QuestionDrawer 与 useQuestionHighlight，Artifact 场景本期仅展示此处提问；消息正文动作、草稿保护和临时高亮行为保持。
- [ ] 5.4 通过现有 net commands 和工作区编排提交；以 Artifact 来源而非焦点列放置分支，处理来源列未展开、成功清理、失败保留、幂等重试和重复点击。
- [ ] 5.5 完成手机原生选区、Drawer 层级与键盘焦点处理；关闭提问层不误关阅读层/丢草稿，成功后显露新列，桌面复用现有放置预览。

## 6. 来源定位与分支标记

- [ ] 6.1 为 Thread 来源与实际存在的 Artifact Quote 接通产物导航：打开指定 Artifact、等待内容根就绪、滚动及短暂高亮；无 Quote 时不伪造消息引用块。
- [ ] 6.2 按 forkArtifactId 过滤既有分支标记并复用高亮逻辑；覆盖文档内重复句子、不同文档相同句子、消息正文同句、定位失败降级及卸载清理。

## 7. 集成验收

- [ ] 7.1 运行数据库/API 行为验证：非法来源、旧正文请求、两类首次发送、引用删除、幂等、外键/删除行为；每批实现后运行 pnpm typecheck，修复错误再继续。
- [ ] 7.2 运行真实上下文回归：Artifact-only 全文、删 Quote、空分支后代、去重、预算、历史前缀及固定旧产物回放；结果以最终模型请求为准。
- [ ] 7.3 浏览器桌面验收并截图：消息卡片/项目列表入口、划选带问、来源返回、来源列不在屏幕、刷新、失败保留及旧正文分支回归。
- [ ] 7.4 浏览器手机验收并截图：长按/手柄、稳定选区、输入聚焦、Drawer 关闭、取消高亮、重试及成功切换新列；覆盖项目目标/附件/复制等面板回归。
- [ ] 7.5 检查规范与代码对应，运行 pnpm openspec:validate 和必要的现有检查；清理重复逻辑，将新增常量归入 constants，不手工执行 format。

## 8. 数据库集成与发布

- [ ] 8.1 在 develop 的单一集成任务生成 additive migration，检查意外删除/重命名，并在上一版结构数据库运行 db:migrate 验证升级及旧数据读取。
- [ ] 8.2 按数据库 → 兼容服务端 → 新客户端顺序发布；确认停用创建入口仍能回放已有 Artifact 分支，再将完成的 delta 按 OpenSpec 流程归档同步。
