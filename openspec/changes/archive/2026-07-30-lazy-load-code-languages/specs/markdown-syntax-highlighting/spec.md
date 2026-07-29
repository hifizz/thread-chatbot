## ADDED Requirements

### Requirement: 扩展语言 grammar 按需懒加载并会话级缓存

系统 MUST 在遇到 EAGER 基础集合之外、但存在于受控 loader 注册表中的语言时,动态加载该语言 grammar 并注入当前单例 highlighter,MUST 在同一会话内复用已加载 grammar 而不重复加载,MUST 对并发的同语言加载去重为单次加载,并 MUST 在 grammar 到位前保持可读、可复制的 plaintext。

#### Scenario: 首次遇到受控扩展语言

- **WHEN** 稳定后的 fenced code 声明一个受控扩展集合内、尚未加载的语言(如 Java、SQL)
- **THEN** 系统动态加载该语言 grammar 并注入单例 highlighter
- **AND** grammar 到位后异步高亮该代码块
- **AND** 加载完成前该代码块显示 escaped plaintext

#### Scenario: 同语言再次出现复用缓存

- **WHEN** 同一会话内再次渲染一个此前已加载 grammar 的扩展语言代码块
- **THEN** 系统直接复用单例 highlighter 中已加载的 grammar
- **AND** 不再重复动态加载该语言 grammar

#### Scenario: 并发触发同语言懒加载

- **WHEN** 同一屏内多个相同扩展语言的代码块同时触发懒加载
- **THEN** 系统仅加载一次该语言 grammar
- **AND** 所有并发代码块共享同一次加载结果

#### Scenario: 扩展语言 grammar 加载失败

- **WHEN** 某个扩展语言 grammar 的动态加载失败
- **THEN** 受影响代码块降级为 escaped plaintext
- **AND** 保留原始语言标签且复制按钮仍复制原始代码
- **AND** 不抛出导致整条 Markdown 渲染失败的异常

## MODIFIED Requirements

### Requirement: 支持受控语言、别名和安全 fallback

系统 MUST 仅加载受控集合中声明的浏览器语言和主题,该集合由 EAGER 基础集合与受控扩展集合共同界定:EAGER 基础集合 MUST 在 highlighter 初始化时同步加载,受控扩展集合 MUST 按需增量加载(见"扩展语言 grammar 按需懒加载并会话级缓存")。系统 MUST 规范化已声明的常用别名,MUST 允许受控扩展语言通过规范化放行而不在规范化阶段被降级,并 MUST 将空语言、注册表外的未知语言或加载失败的语言降级为 escaped plaintext。

#### Scenario: 使用语言别名

- **WHEN** fence 使用 `js`、`ts`、`sh`、`shell`、`zsh`、`md` 或 `golang` 等已声明别名
- **THEN** 系统使用对应的规范 grammar 高亮

#### Scenario: 使用 EAGER 基础语言

- **WHEN** fence 声明一个 EAGER 基础集合内的语言(如 go、rust、zig)
- **THEN** 系统使用初始化时已同步加载的 grammar 高亮
- **AND** 不触发额外的动态 grammar 加载

#### Scenario: 使用未知语言

- **WHEN** fence 声明一个受控集合外未配置的语言
- **THEN** 系统以 plaintext 显示完整原始代码
- **AND** 保留原始语言标签
- **AND** 不抛出导致整条 Markdown 渲染失败的异常

#### Scenario: highlighter 初始化失败

- **WHEN** Shiki engine、theme 或 grammar 初始化失败
- **THEN** 受影响代码块降级为 escaped plaintext
- **AND** 复制按钮仍复制原始代码

### Requirement: 浏览器成本必须有界

系统 MUST 复用单例 highlighter 和已加载的 grammar/theme,MUST 使用受控的细粒度浏览器导入(每个受控扩展语言经显式 loader 注册表切分为独立 lazy chunk,而非按内容动态拼接的全量导入),MAY 在会话内按需将受控扩展语言 grammar 增量加载进单例 highlighter,该增量加载 MUST 去重且已加载后 MUST 复用,并 MUST NOT 建立按完整代码内容永久增长的全局结果缓存。

#### Scenario: 页面包含多个同语言代码块

- **WHEN** 多个消息渲染相同受支持语言的 fenced code
- **THEN** 它们复用同一个 highlighter 和已加载 grammar
- **AND** 不为每个代码块重新初始化 engine 或重复加载同一 grammar

#### Scenario: 打包受控扩展语言

- **WHEN** 构建产物为受控扩展语言切分懒加载 chunk
- **THEN** 仅注册表中声明的语言生成对应 lazy chunk
- **AND** 未声明的语言不进入客户端产物

#### Scenario: 消息卸载

- **WHEN** 一个已高亮消息从 UI 卸载
- **THEN** 其组件级代码结果可以被回收
- **AND** 全局状态不保留以完整代码字符串为 key 的永久缓存条目
