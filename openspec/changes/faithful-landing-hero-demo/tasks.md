## 1. 演示态与放置基础

- [x] 1.1 新增 `hero-demo/demo-placement.ts` 精简放置：replace/fold、`targetId > keepSource > 默认`、预览与提交共用、窄屏裁列，上限来自视口/强制列数，LRU 用本地活跃序
- [x] 1.2 在 `DemoPlayer` 级引入本地演示态（列槽/折叠/宽度/活跃序/本地消息/反馈/`@` 胶囊/划选），与 `viewAt()` 时间线合并输出，`interact()` 暂停播放、`jump(0)` 同时重置两层

## 2. 列框架与顶栏对齐

- [x] 2.1 对齐演示顶栏为可操作子集：列 active、画布 disabled 加说明、列数可用、替换⑥/细条⑤可用、会话树·N 与 Project·M 计数、`新对话`重置演示
- [x] 2.2 对齐列头与来源区：主列 `锚定`＋主线＋副标题＋子分支计数小面板；分支列可点击面包屑＋`L{depth}`＋标题＋子分支计数小面板＋`⇄ 切换`本地列表＋`收起`；讨论焦点横幅＋`继承的上文`（`你`/`AI` 截断行）
- [x] 2.3 补齐列容器行为：折叠竖条（脚注徽＋竖排标题＋原地展开）、列间分割线拖拽/键盘步进/双击重置（宽度会话内保持）、每列滚到底按钮（贴底隐藏）

## 3. 消息呈现与消息工具条

- [x] 3.1 对齐消息呈现：`你`/`AI` 标签、用户右气泡、助手 prose（含标题/列表/表格）、流式 caret/typing、锚点下划线＋脚注上标（点击开右侧分支，`⌘` 保留来源列，编号与分支 footnote 一致）
- [x] 3.2 本地实现消息工具条：复制/仅最新可重生成/赞成反对（含 pressed 态与禁用 tooltip），复制走剪贴板、重生成重播本列流式、失败仅本地 `role=alert` 提示，不调模型不写会话

## 4. 划选分支链路

- [x] 4.1 新建 `demo-selection.tsx` 之工具条：仅助手正文原生划选触发，`在当前对话问`/`此处提问`两键（文案复用 `SELECTION_TOOLBAR_COPY`，箭头键导航），定位相对演示容器换算＋边界夹取，`Esc`/点空关闭
- [x] 4.2 同文件实现提问气泡：引用＋可选首问＋迷你列条（几何复用 `BUBBLE_*`，预览与提交共用 `demo-placement.ts`）＋`开启分支讨论`/`带着问题开分支`；空提交保留 kickoff 预填待确认，非空成为新分支首条 user 消息；在当前对话问则写入本列 composer 待发上下文

## 5. 输入框与 @ 引用

- [x] 5.1 补齐输入框工作台元素：附件入口＋本地文件名托盘、主列模型菜单 vs 分支列锁定提示（`COMPOSER_MODEL_COPY.branchLocked`）、参数入口最小面板、语音 disabled 占位、发送/流式停止态
- [x] 5.2 实现 `@` 引用闭环：`@` 菜单沿用 `Command`＋Popover、选中插入不可编辑胶囊＋`X` 移除（占位用 `ARTIFACT_REFERENCE_COPY.placeholder`），发送后本地续写剧本主线结论

## 6. Artifact 卡

- [x] 6.1 新增 `demo-artifact-card.tsx`：照 `.acard` 结构（icon＋标题＋kind 行＋打开＋深度色左缘），点击开本地预览不导航；生成中先走虚线占位卡（status＋spinner＋字符/行数＋最近章节＋进度条），由 artifact 时间线驱动

## 7. 播放、游标与样式隔离

- [x] 7.1 更新游标与章节：`data-cursor-target` 随新 DOM 补齐（工具条两键、气泡提交、脚注、切换、胶囊、发送、artifact），保留暂停/重播/减弱动效/后台暂停语义，全剧本播放落点在可见控件上
- [x] 7.2 手工移植样式到 `.threadchat-landing .landing-demo` 下（topbar/columns/messages/composer/selection/message-actions/artifact-card/columns-collapse 视觉值映射到 landing 纸面 palette），不引 `.tc` 类与 `var(--tc-*)`，不新增依赖，保留窄屏横滑

## 8. 验证与回归

- [x] 8.1 扫除魔法串（文案/尺寸收敛到 `constants/`），跑 `pnpm typecheck` 与改动范围 ESLint 并清零错误
- [x] 8.2 跑生产构建，走查六套剧本切换、划选开分支、分支发送、列切换/收起/拖宽、`@` 引用/移除/发送、复制/重生成/反馈、暂停重播、窄屏横滑、reduced-motion、重载恢复剧本起点，确认无模型调用、无会话创建、无 DB 写入、无工作台样式泄漏
