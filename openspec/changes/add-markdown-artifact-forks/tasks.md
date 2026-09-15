本清单描述 Markdown Artifact 划选分支的实施进度。功能代码已在本 Change 分支开始实现；数据库正式 migration 仍按设计留给 develop 集成阶段统一生成。

## 1. 契约与选区文本基础

- [x] 1.1 复核实施基线及引用相关 change 的归档状态；保留正文 Fork、Quote 删除、固定 Artifact ID 和冻结历史合同，确认本期父节点固定为 Artifact 来源 Thread。
- [x] 1.2 定义共享 message/artifact 来源类型与 Fork target Schema；沿用现有 firstTurn/Parts 类型，规范化旧 anchorText/anchor 请求，拒绝混合歧义字段和客户端权威全文。
- [x] 1.3 建立 Markdown 可选文本的纯函数规则与前后端固定样例，覆盖格式、链接、列表、表格、代码、换行、中文/emoji、重复原文和排除的界面文字；不支持区域明确拒绝。

## 2. 数据字段与回放链路

- [x] 2.1 在 Schema 源码增加 nullable forkArtifactId、外键、根节点约束及项目内查询索引；功能分支不生成或修改 drizzle migration。
- [x] 2.2 补齐 Thread DTO、repository mapper、客户端 store 与视图适配；旧记录读为 null，Artifact 分支不错误绘制为消息正文分支。
- [ ] 2.3 覆盖来源在项目刷新、分支树、导出和现有分享序列化中的保留；验证被引用 Artifact 不能被单独删除，项目整体删除依赖顺序正常。

## 3. 分支命令与 Quote 校验

- [x] 3.1 扩展 fork-thread 服务：沿用现有锁顺序/幂等事务，验证 Project 所有权、归档状态、Markdown/completed、有效时间线、父 Thread 和 Message 来源一致性。
- [x] 3.2 集成 Artifact Anchor 验证，先位置后原文/上下文消歧；无匹配、歧义和超限明确拒绝，不用 fuzzy 授权，不改变已接受 exact。
- [x] 3.3 持久化 forkArtifactId 及既有锚点、脚注和 forkContext；带问请求原子创建消息，留空只建 Thread，事务外沿用既有生成启动。
- [x] 3.4 扩展 frozenFirstQuote 及首次发送校验，支持精确匹配 Fork 的 Artifact Quote；验证发送前删除、编辑删除、替代消息与无 Quote 分支，保持普通跨 Thread Quote 限制。
- [ ] 3.5 验证重复 commandId 同请求返回同一结果、异请求拒绝、无半成品写入且不重复生成；覆盖请求成功但响应丢失后的恢复。

## 4. 模型上下文

- [x] 4.1 在统一模型上下文边界把 Artifact Fork 来源按固定来源 Message 注入；若原工具输入已含完整正文则只保留固定引用标记，否则展开权威全文。
- [x] 4.2 接通现有 Artifact 引用去重路径；完整工具输入与补充引用共用 seen 集合，不重复发送正文。
- [x] 4.3 Artifact 来源沿 Thread 父链收集，因此空分支、刷新和后代分支继续继承祖先 Artifact；选区仍只来自实际 Quote Parts，不从 Thread 锚点补回。
- [ ] 4.4 以真实最终模型请求补集成回归：两个同历史不同 Quote 的共同前缀一致，并覆盖预算/unknown 计量。

## 5. 阅读组件与划选交互

- [ ] 5.1 从生产 ProjectPanel 抽出 ArtifactDetail，保留复制、来源、标题与阅读能力；新增轻量 SelectionSurface，MarkdownBody 保持纯渲染职责。
- [x] 5.2 在唯一 useAssistantTextSelection 入口扩展来源解析，支持 message/artifact 联合 SelectionInfo；不按阅读实例新增 document 监听器。
- [x] 5.3 扩展 SelectionBubble/Toolbar/QuestionDrawer：Artifact 场景本期仅展示此处提问；消息正文动作、草稿保护和临时高亮行为保持。
- [x] 5.4 通过现有 net commands 和工作区编排提交；以 Artifact 来源而非焦点列作为 parent/source identity。
- [ ] 5.5 完成手机原生选区、Drawer 层级与键盘焦点的真实设备/浏览器验收。

## 6. 来源定位与分支标记

- [x] 6.1 Thread focus banner 与实际 Artifact Quote 均可打开来源 Artifact；等待内容根就绪后精确定位、滚动并短暂高亮，失败明确提示且重试有上限。
- [x] 6.2 Artifact Fork 通过 forkArtifactId 从来源 Message 正文 Fork 中过滤；相同句子不会被画到消息正文，来源定位先锁定 Artifact ID 再匹配 Anchor。

## 7. 集成验收

- [ ] 7.1 运行数据库/API 行为验证：非法来源、旧正文请求、两类首次发送、引用删除、幂等、外键/删除行为；运行 typecheck 并修复错误。
- [ ] 7.2 运行真实上下文回归：Artifact-only 全文、删 Quote、空分支后代、去重、预算、历史前缀及固定旧产物回放；结果以最终模型请求为准。
- [ ] 7.3 浏览器桌面验收并截图：消息卡片/项目列表入口、划选带问、来源返回、来源列不在屏幕、刷新、失败保留及旧正文分支回归。
- [ ] 7.4 浏览器手机验收并截图：长按/手柄、稳定选区、输入聚焦、Drawer 关闭、取消高亮、重试及成功切换新列；覆盖项目目标/附件/复制等面板回归。
- [ ] 7.5 检查规范与代码对应，运行 pnpm openspec:validate 和必要的现有检查；清理重复逻辑，将新增常量归入 constants，不手工执行 format。

## 8. 数据库集成与发布

- [ ] 8.1 在 develop 的单一集成任务生成 additive migration，检查意外删除/重命名，并在上一版结构数据库运行 db:migrate 验证升级及旧数据读取。
- [ ] 8.2 按数据库 → 兼容服务端 → 新客户端顺序发布；确认停用创建入口仍能回放已有 Artifact 分支，再将完成的 delta 按 OpenSpec 流程归档同步。
