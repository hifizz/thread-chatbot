## ADDED Requirements

### Requirement: 编辑式首页叙事
系统 SHALL 将公开根路由呈现为按固定阅读顺序组织的 Thread Chat 产品首页：导航、视频 Hero、产品声明、Why I built、Why not existing chat、开始使用 CTA 和页脚。首页 SHALL 不呈现此前首页的纸张网格、手绘标识、复杂导航、产品模拟图网格或多色强调体系。

#### Scenario: 访客阅读首页结构
- **WHEN** 访客打开 `/`
- **THEN** 页面按规定顺序呈现每个 section，并提供一个可见的开始聊天入口

### Requirement: Hero 视频及缺省状态
系统 SHALL 在 Hero 中提供响应式 16:9 视频容器和左下角 slogan `Your thoughts are allowed to branch.`。视频 SHALL 使用静音、循环和内联播放配置；在视频资源缺失、加载失败或无法播放时，系统 MUST 保留同尺寸的静态占位和 slogan。

#### Scenario: 视频资源尚未提供
- **WHEN** 配置的视频资源不存在或不能播放
- **THEN** Hero 保持 16:9 布局、显示静态占位和 slogan，且页面的 CTA 与后续内容仍可访问

### Requirement: Thread Chat 视觉一致性
系统 SHALL 使用与 `/thread-chat` 一致的暖黄背景 `#f5f2ea`、黑色正文 `#24211b`、次级文字 `#6a6357`、分隔线 `#e2dccd` 和绿色交互 `#2f7d6b`。系统 SHALL 使用与 `/thread-chat` 相同的无衬线 UI 字体栈。主要 CTA MUST 使用绿色实底和白色文字。

#### Scenario: 访客识别主要行动
- **WHEN** 访客查看导航或页面底部 CTA
- **THEN** `Get started` 或 `Follow your next question` 以绿色主按钮呈现，并具备可见的键盘焦点状态

### Requirement: 可验证的产品差异化说明
系统 SHALL 用可验证的产品文案说明 Thread Chat 支持锚点上下文继承、主线不受分支干扰、持久化的树与工作台，以及从分支生成 Markdown。系统 MUST 将这些能力与现有聊天产品的临时 thread 或 branch 作结构性区分，而不对第三方产品作不可验证的性能或质量比较。

#### Scenario: 访客阅读现有工具限制
- **WHEN** 访客抵达 Why not existing chat section
- **THEN** 页面说明临时分支不足以形成持续思考结构，并列出 Thread Chat 的具体结构能力

### Requirement: 移动端可读性与触达
系统 SHALL 在窄屏下将页面转换为单列阅读布局，保留品牌和单一导航 CTA，使用 20px 页面侧边距，并令底部 CTA 占满可用宽度。系统 MUST 保证视频、slogan 和文本不发生水平溢出。

#### Scenario: 375px 宽度下访问首页
- **WHEN** 访客以 375px 宽度打开首页
- **THEN** 页面不产生横向滚动，视频占满内容宽度，导航 CTA 和底部 CTA 均可触达
