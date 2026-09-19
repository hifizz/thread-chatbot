# Design: 可交互演示首页

## 结构

```text
app/page.tsx
└── LandingHeader / Hero / ScenarioDemo / FeatureSection / FaqSection / ClosingCta / LandingFooter

components/landing/demo/
├── use-demo-player.ts   状态机：(scenario, stepIndex, revealCount) → DemoView
├── demo-frame.tsx       顶栏 + 列容器 + 模拟光标挂载点
├── demo-column.tsx      列头(面包屑/深度徽标/来源横幅) + 消息流 + composer
├── demo-message.tsx     消息气泡、锚点高亮+脚注、划选气泡、Artifact 卡片
├── demo-composer.tsx / artifact-picker.tsx   仿 .tc composer 与 @ 弹层
├── chapter-stepper.tsx  章节步骤条 + 播放/暂停/重播
└── demo-cursor.tsx      data-cursor-target 定位的模拟光标

constants/landing-demo.ts   六套类型化剧本（columns/messages/steps/anchors/pickerItems）
constants/landing.ts        页面文案
components/landing/landing-demo.css   演示样式，全部在 .ld 作用域
```

## 关键决策

- **视图折叠派生**：`buildView(scenario, stepIndex, revealDone)` 把 steps[0..k] 折叠成确定画面。跳到任意章节得到完整一致状态，不依赖按顺序播放；暂停只是停计时器，画面原样保留。手动交互（点锚点、选 Artifact）映射回「settleAt(对应步骤) + 覆盖参数」，与自动播放共享同一份状态。
- **手动选择覆盖**：`pickedId`/`pickerClosed` 记录用户在 @ 弹层里的实际操作——选任意列表项都落到「选择结论」步骤并用所选项渲染胶囊；Escape 真正关闭弹层并把焦点还给 composer。
- **揭示与自动滚动**：打字揭示按字符数截断渲染；列内容增长时 `.msg-list` 滚到底部，模拟真实流式阅读。
- **视口驱动自动播放**：IntersectionObserver ≥35% 可见才播；`prefers-reduced-motion` 时 instantReveal 且不自动播放。
- **样式隔离**：演示 DOM 复刻 `.tc` 结构但类名收敛在 `.ld` 容器内（landing-demo.css），页面其余部分用 CSS Module；不改 `.tc` token 与聊天页面样式。

## 剧本语义边界（与真实产品一致）

- 分支继承创建时已有上文，之后独立发展，不随主线编辑自动变化。
- 分支新消息不自动进入主线；用 `@Artifact` 主动引用所选结论（引用标记，非整段合并）。
- 不展示跨消息多选、QuickAsk、自动合并、报名/候补流程。
