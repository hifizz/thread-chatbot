# 实施登记

## 颜色映射

| 旧值/旧 token | 新 semantic token | 说明 |
|---|---|---|
| `--paper` | `--tc-surface-base` | `#fdfbf8`，值不变 |
| `--paper-2` | `--tc-surface-raised` | `#f4f0e9`，值不变 |
| `--user-bg` | `--tc-surface-sunken` | `#e8e2d3`，值不变 |
| `--ink/--ink-soft/--ink-faint` | `--tc-content-primary/secondary/muted` | 值不变 |
| `--rule/--rule-strong` | `--tc-border-subtle/strong` | 值不变 |
| `--d1..5` | `--tc-depth-1..5` | 值不变 |
| `--font-ui/read/mono` | `--tc-typography-family-ui/read/code` | 字体栈不变 |
| `#b07d2e` | `--tc-depth-2` | 同值归位；未改变未保存态颜色 |
| `#b03a2e/#8e2626` | `--tc-danger/--tc-danger-deep` | 功能红语义化 |
| `#8a8377` | `--tc-depth-neutral` | 主线/无分支的中性深度色 |
| `#fff` | `--tc-surface-plain` 或 `--tc-content-on-accent` | 按表面/前景用途拆分 |

primitive 仅定义在 `tokens/palette.css`；区块文件只消费 semantic/contextual token。

## 派生色用途聚类

`tokens/color-derived.css` 是 `color-mix()` 与 alpha 色的唯一生产代码归属文件：

- contextual accent：浅底、选中底、焦点环、横幅底/边框、闪烁色、Artifact tab 底。
- fork color：锚点下划线/高亮、Artifact 图标/进度底、进度轨道。
- ink：消息操作 hover、引用条底/边框/文字。
- depth：diff 行、代码高亮行、槽位替换/折叠预览、未保存徽标。
- surface：滚到底玻璃面、停止条、键帽、MiniMap 遮罩。
- on-ink：划选气泡与 toast 的白色透明状态层。
- shadow/scrim：按卡片、浮层、抽屉、弹层、toast 用途命名。

contextual 派生公式在实际注入边界重新声明，避免自定义属性在 `.tc` 根提前计算后无法响应后代 `--tc-accent`/`--fc` 覆盖。ego-browser 已验证 depth-2 注入后 9% accent 与 20% fork 高亮均使用 `#b07d2e` 计算。

## 数值取整

按批准的银行家舍入映射处理全部半像素字号：

- `10.5px → 10px`
- `11.5px → 12px`
- `12.5px → 12px`
- `13.5px → 14px`
- `14.5px → 14px`
- `15.5px → 16px`

prose token 的标题间距、列表项间距、引用缩进与代码 padding 同步调整为邻近偶数。以下亚像素值因几何或辨识度原因保留，并已在使用处添加 `tc-review`：

- `letter-spacing: 0.5px/0.6px`：品牌字标、标签和代码语言标签辨识度。
- `outline/border: 1.5px`：深底焦点环与 ghost 虚线可见度。
- `margin: 0 -4.5px`：9px 列拖拽热区对称跨列。

## z-index 与层叠审计

- 列内局部层：under/base/raised/top = `0/1/2/3`。
- 文档弹层：selection/drawer/switcher/switcher-top/toast = `60/65/72/74/80`。
- 10 处裸 z-index 已全部替换为 `--tc-z-*`。
- 列内 token 只在 `.column` 或 selection 内容内部的局部层叠上下文生效；文档弹层均为 `position: fixed`，未发现带 transform/filter/opacity 的共同祖先隔离其层级。

## Container containment 审计

- `.lane`：只包列内阅读内容；switcher/help-panel 不在其后代，不改变弹层定位祖先。
- `.art-body`：只包抽屉正文，不包含抽屉自身或全局弹层。
- `.canvas-expand`：容器声明在外挂面板自身；面板仍由 `.canvas-card { position: relative }` 定位，containing block 不变。
- 断点：窄 `<480px`、标准 `480–720px`、宽松 `>720px`。
- `.tc-prose-compact` 使用各档位离散偶数 token，不使用会产生亚像素值的 `0.9` 乘法。
- ego-browser 计算样式验证：420/600/760px 普通正文为 14/16/16px，compact 为 12/14/14px；标题档位同步且全部为偶数。

## 浏览器验收

使用 ego-browser task space 17 对真实页面与 Gate 3 harness 完成验证：

- 单列桌面（1660px）：正文 16px / 27.2px，`.md-body.tc-prose` 双类并存，`.lane` 为 `tc-prose / inline-size`，通道宽 760px。
- 多列桌面（900px）：两列宽 451/450px，正文容器宽 414px，正确进入窄档 14px、h1 20px，未误套宽松档。
- 移动端（390×844）：正文 14px、h1 20px，无文档横向溢出。
- Drawer：桌面与移动端均正常；移动端宽 359px，`.art-body` 容器查询生效，无横向溢出。
- Canvas：桌面与移动端均能切换，卡片正常显示；MiniMap 遮罩使用 `--tc-canvas-minimap-mask`。
- contextual 派生色：depth-2 注入后的 accent 9% 与 fork 20% 均由 `#b07d2e` 正确计算。
- compact 独立测试：420/600/760px 下普通正文为 14/16/16px，compact 为 12/14/14px；标题 token 同步且全部为偶数。

最终验证：`pnpm typecheck`、`pnpm build`、`pnpm openspec:validate` 均通过；OpenSpec 27/27 项合法。

## 扫描豁免

`app/thread-chat/gate-3-harness/normalized-harness.tsx` 的控制面板是测试 harness 自身，不属于 `.tc` 产品样式体系；其中 3 处内联测试页颜色列为 grep 白名单。Shiki 运行时主题色注入同样豁免。

## Future Work

- space / radius / elevation / state 类目。
- sizing / motion / focus / scrim 类目。
- UI 排版 role（body/label 等）。
- JavaScript 主题配置注入机制。
- 深浅色主题。
- 将 `tokens/` + `.tc-prose` 抽成纯 CSS npm 包，并视需要增加 Tailwind v4 plugin 包装层。
