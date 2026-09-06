## ADDED Requirements

### Requirement: Owner creates an immutable snapshot share

系统 SHALL 仅允许已登录的资源所有者为自己的 Project 或 Markdown Artifact 创建分享。系统 MUST 从服务端持久化数据构建快照，并在同一一致读取事务内保存内容、初始布局、token 和生命周期字段。系统 MUST NOT 接受客户端正文、所有者身份或时间作为权威值，也 MUST NOT 自动把任何旧资源设为公开。

#### Scenario: Create a Project snapshot

- **WHEN** 所有者提交自己的已存在 Project、有效期和合法当前布局
- **THEN** 系统原子保存白名单快照并返回独立匿名链接，原 Project 不发生修改

#### Scenario: Reject another owner's resource

- **WHEN** 用户提交另一个用户的 Project 或 Artifact ID，或同 owner 不同 Project 的伪造关联
- **THEN** 系统拒绝创建，不返回他人正文、标题或 token，不保存分享

#### Scenario: Reject client supplied private fields

- **WHEN** 创建请求附带正文、ownerId、token、expiresAt、Memory、Instructions 或未支持的分享类型
- **THEN** 系统按严格请求契约拒绝该输入，不把这些字段持久化为快照

#### Scenario: Source changes during creation

- **WHEN** 生成快照期间另一个请求新增 Thread、替换 Message 或保存 Artifact
- **THEN** 成功的快照来自同一数据库可见时点，不能拼接不同轮读取的状态；失败不产生部分可访问快照

### Requirement: Snapshot immutability and idempotent creation

系统 SHALL 固定创建成功时的内容与布局，不提供覆盖快照、实时同步或内容版本历史接口。创建命令 MUST 幂等；更新分享内容 MUST 创建新的分享记录和链接。

#### Scenario: Original content or layout changes

- **WHEN** 创建分享后原 Project 新增内容、编辑、重命名、重新生成或改变工作台布局
- **THEN** 旧链接仍显示原快照内容和原初始布局，不读取新的源数据

#### Scenario: Replay creation

- **WHEN** 同一用户重放相同 commandId 和相同输入的创建命令
- **THEN** 系统返回第一次的分享记录，不重读源正文、不新建 token、不延长有效期

#### Scenario: Conflicting command replay

- **WHEN** 相同 commandId 被用于不同有效期、布局或资源
- **THEN** 系统拒绝冲突，不改变已经创建的分享

#### Scenario: Publish an updated result

- **WHEN** 所有者为修改后的资源再次显式创建分享并使用新命令 ID
- **THEN** 系统生成新的链接，旧链接独立保持其内容及撤销/到期状态

### Requirement: Project snapshot preserves readable branches

Project 快照 SHALL 覆盖全部 Thread，而不仅是当前打开的列。系统 MUST 保存当前可读消息，以及分支冻结上下文、分叉来源和纳入 Artifact 来源所需的最小历史集合，保持快照内关联闭合。系统 MUST NOT 顺带暴露无关历史版本或从私有源接口补全缺失内容。

#### Scenario: Open a Thread absent from initial layout

- **WHEN** 匿名读者选择一个创建分享时未打开的 Thread
- **THEN** 能在快照内打开其消息和必要阅读上下文，无需私有 Bootstrap 或登录

#### Scenario: Parent source was superseded

- **WHEN** 某分支引用的父消息在分享前已被替换
- **THEN** 快照保留该分支所需旧来源和继承消息，可以阅读与定位，并保持父 Thread 的当前时间线不被旧消息替换

#### Scenario: Unrelated superseded messages exist

- **WHEN** Project 有不被任何分支或纳入 Artifact 阅读关系引用的已替换消息
- **THEN** 这些消息不进入公开快照或公开历史列表

#### Scenario: Cross Project or missing reference

- **WHEN** 构建快照发现必要消息引用不存在或归属其他 Project
- **THEN** 创建失败且不保存公开链接，不去其他 Project 读取正文或生成断裂快照

### Requirement: Generation remains static in a snapshot

系统 SHALL 将分享时的生成状态表示为静态阅读状态，不等待、启动、恢复或订阅模型。Project 快照只纳入来源已 completed 的 Markdown Artifact 正文；系统 MUST NOT 发布瞬态工具输入或内部错误详情。

#### Scenario: Project contains an active generation

- **WHEN** 分享创建时某消息仍在 generating
- **THEN** 快照保留该消息位置及“分享时尚未完成”标记，不复制未持久化流或工具输入，之后源生成完成不更新该标记

#### Scenario: Project contains a stopped or failed message

- **WHEN** 分享创建时消息为 stopped 或 failed
- **THEN** 快照可呈现其持久化可见正文和简洁状态，不包含内部错误信息，也没有 Retry 或 Stop 入口

### Requirement: Standalone Markdown Artifact has an isolated scope

系统 SHALL 仅为来源 completed 且已持久化的 Markdown Artifact 创建独立分享。该快照 MUST 仅含该产物的公开标题、正文和必要产物时间，不包含来源对话正文、私有来源导航或来源 Project/Thread 元信息。

#### Scenario: Read one Artifact anonymously

- **WHEN** 读者打开有效 Markdown Artifact 分享链接
- **THEN** 能阅读该文档，页面与接口均不返回来源 Project/Thread/Message 或其他产物

#### Scenario: Source Project also has a share

- **WHEN** 同一个 Artifact 的来源 Project 另有分享链接
- **THEN** Artifact 链接仍不自动暴露该 Project 链接或获得其访问权限

#### Scenario: Unsupported or incomplete Artifact

- **WHEN** 用户尝试分享非 Markdown 类型、尚未持久化或来源未 completed 的 Artifact
- **THEN** 系统拒绝创建并解释不可分享状态，不扩大一期类型范围

### Requirement: Explicit expiry options and revocation

分享有效期 SHALL 仅提供 3 天、7 天、30 天、无限四种选项，默认无限；有限有效期 MUST 从服务端创建时间起计算固定日数。系统 MUST 在每次公开内容请求时判断 revokedAt 为空且当前时间严格早于 expiresAt（或 expiresAt 为空）。所有者 SHALL 能查看自己资源的分享列表、复制已有链接和撤销，其他人及仅持 token 者 MUST NOT 能管理分享。

#### Scenario: Default and finite expiry

- **WHEN** 所有者不指定有效期，或分别选择 3、7、30 天
- **THEN** 前者保存 expiresAt=null；后者分别保存 createdAt 加 3、7、30 个 24 小时，时间由服务端确定

#### Scenario: Expiry boundary

- **WHEN** 读者分别在 expiresAt 之前及等于/晚于 expiresAt 时请求内容
- **THEN** 未撤销的前者成功，后者拒绝，且不依赖定时清理任务

#### Scenario: Owner revokes a link

- **WHEN** 所有者撤销一个仍有效的分享，然后读者再次请求
- **THEN** 新请求无法取得内容；重复撤销不报非幂等错误，不允许恢复该链接

#### Scenario: Unauthorized management

- **WHEN** 匿名者、其他用户或仅持分享 token 的人请求创建、列表或撤销接口
- **THEN** 系统按登录/所有权规则拒绝，不泄露列表或更改分享状态

#### Scenario: Source Project is deleted

- **WHEN** 所有者删除来源 Project
- **THEN** 系统级联移除该 Project 的分享记录，后续请求不可访问；归档或编辑不产生相同失效效果

### Requirement: Anonymous routes do not weaken private authorization

系统 SHALL 提供独立公开页面 `/share/{token}` 和仅用于快照的读取路径，通过不可猜测 token 定位 Share。页面、JSON、HTML/RSC 与 metadata MUST 共用有效性检查；系统 MUST NOT 将 token 当作任何私有 API、附件 API 或写命令的授权。

#### Scenario: Anonymous first visit through proxy

- **WHEN** 没有 cookie 的读者访问有效分享页
- **THEN** 请求经过 proxy 后仍能阅读，不跳转登录；公开匹配不放行其他私有路径

#### Scenario: Invalid link

- **WHEN** token 不存在、格式错误、已撤销或已到期
- **THEN** 返回统一的分享不可用页面/响应，不包含资源标题、正文或 owner 信息

#### Scenario: A reader probes private endpoints

- **WHEN** 读者用分享内 ID 或 token 请求私有 Project、Message、Artifact、附件或生成 API
- **THEN** 原登录和所有权门禁仍生效，分享不授予新访问权或写权限

### Requirement: Public output excludes private fields before storage

系统 MUST 使用显式公开白名单在持久化前构造快照，并在响应时只序列化公开契约。系统 MUST NOT 保存或下发 Memory、Contract 的 target/instructions、系统提示词、Files/附件元数据与字节、签名地址、账号信息、内部配置/错误/原始工具数据；未知 message part 或 metadata MUST 默认排除。仅删除 UI 入口或把敏感字段置为不可见不满足本要求。

#### Scenario: Private fields contain sentinel values

- **WHEN** 源对象的 Memory、Instructions、Files、tool metadata、内部错误含不同的测试秘密哨兵
- **THEN** 持久化快照、匿名 JSON、HTML/RSC、DOM 和 metadata 中均不存在这些哨兵

#### Scenario: Read approved message parts

- **WHEN** Message 包含 text、quote、界面 reasoning、来源信息和 tool parts
- **THEN** 正文与引用被逐字段处理；其他内容仅返回已明确审查的阅读字段，不透传 provider metadata、工具参数或检索全文

#### Scenario: A new private part is added later

- **WHEN** 源数据新增白名单不认识的 data/tool part 或嵌套字段
- **THEN** 该字段不会自动进入新快照，已有快照也不改变

### Requirement: Markdown and links preserve the attachment boundary

系统 MUST 在持久化前清理进入公开阅读内容的已知私有附件路径、对象存储地址、签名 URL 和不安全协议，覆盖正文、quote、reading summary 与来源链接。公开页面 MUST NOT 下载、代签、内联附件或执行 HTML/脚本，也 MUST NOT 自动加载外部图片。安全外部资料链接可供读者主动打开，外部页面内容不属于冻结范围。

#### Scenario: Private links appear in multiple Markdown forms

- **WHEN** 私有附件 URL 以相对/绝对地址、引用式链接、自动链接、图片、纯文本或已配置存储签名地址出现
- **THEN** 公开快照不含该地址，呈现不带私有元信息的安全占位，不发附件请求

#### Scenario: Script or tracking image appears

- **WHEN** 分享正文包含危险协议、HTML/script、外部追踪图片或 Custom Visual
- **THEN** 页面不执行主动内容、不自动发出图片请求，仍安全展示可读文本部分

#### Scenario: Reader opens a safe external source

- **WHEN** 读者主动打开允许的外部 HTTP/HTTPS 来源链接
- **THEN** 导航不携带分享页 referrer，不获得私有附件授权，且不声称外部页面被冻结

### Requirement: Initial layout is captured and restored

Project 分享 SHALL 从当前组件状态捕获视图模式、打开的 Thread 及顺序、折叠/列宽/焦点、画布 pins/viewport 和打开的 Artifact/面板。系统 MUST 校验所有 ID 属于快照及数值有界；分享链接不依赖作者的 localStorage 或长 URL 参数即可恢复初始布局。

#### Scenario: Restore columns and Artifact panel

- **WHEN** 作者在特定列顺序、折叠状态、列宽及 Artifact 面板打开时创建分享，读者用新浏览器打开
- **THEN** 在相同屏幕条件下恢复这些布局状态，不读取作者或读者的私有工作台缓存

#### Scenario: Restore a manually arranged canvas

- **WHEN** 作者拖动节点并调整 viewport 后创建画布分享
- **THEN** 新浏览器首屏使用捕获的 pins 和 viewport，而不是被首次自动 fitView 覆盖

#### Scenario: Invalid or stale layout references

- **WHEN** 布局引用已不存在的 Thread/Artifact 或含非有限/越界数值
- **THEN** 服务端拒绝非法数值输入或规范化失效布局引用为安全初始值，不读取快照外对象

#### Scenario: Read on a narrow screen

- **WHEN** 桌面创建的分享在移动端打开
- **THEN** 界面保留 Thread 顺序与焦点并适配屏幕，全部 Thread 仍可导航阅读，不要求像素级复制桌面列宽

### Requirement: Read only includes local navigation but no business writes

匿名与已登录读者在分享页 SHALL 能切换列/画布、打开/关闭/折叠 Thread、调整阅读布局、定位引用、阅读 Artifact 和复制文本。系统 MUST NOT 在分享页装配业务写命令或模型运行时，包括发送、Fork、Edit、Retry、Stop、反馈、重命名、删除、上传、批注、Memory/Contract 修改、自动标题或会话恢复。

#### Scenario: Reader explores the snapshot

- **WHEN** 读者打开其他 Thread、拖动节点、调整列宽或查看文档
- **THEN** 只有读者的临时阅读状态改变，服务端快照和原 Project 不变；重新打开链接恢复分享初始布局

#### Scenario: Owner opens their own public link

- **WHEN** 已登录的资源所有者打开分享页并使用界面或快捷键
- **THEN** 该页面同样只读，不显示写入口或发出写请求，不影响其私有 workspace 缓存

#### Scenario: Inspect network during reading

- **WHEN** 读者首次加载并完成 Thread 导航、引用定位、文档阅读
- **THEN** 网络中不存在私有 Bootstrap、生成恢复、自动标题、流式订阅、写命令或附件请求

### Requirement: Content responses respect lifecycle and privacy

系统 MUST 对所有公开内容响应禁用持久缓存，共用有效期/撤销检查，不提供可绕过检查的静态快照文件。分享页 SHALL 默认 noindex、不进入 sitemap，并使用 no-referrer；日志 MUST NOT 主动记录完整 token 或快照正文。生命周期限制只约束新的服务端访问，不承诺远程回收已复制内容。

#### Scenario: A previously read share is revoked

- **WHEN** 读者已读过分享，所有者撤销后读者刷新或重新请求 JSON/HTML/RSC
- **THEN** 服务端拒绝返回正文，缓存不得提供旧成功内容绕过校验

#### Scenario: Metadata request for an expired share

- **WHEN** 外部预览或搜索爬虫请求已经过期分享的页面 metadata
- **THEN** 响应不泄露快照标题/正文，且不返回可长期公开的正文预览

### Requirement: Sharing UI communicates snapshot and privacy limits

创建弹窗 SHALL 明确提示内容/布局不会同步更新、任何持链接者可在有效期内阅读、私有配置与附件不分享、正文敏感内容不会自动打码，以及期限/撤销无法收回已复制内容。页面 SHALL 标识只读快照与创建时间，管理列表 SHALL 展示可用、到期或撤销状态。

#### Scenario: Open the share dialog

- **WHEN** 所有者从 Project 顶栏或可分享的 Markdown Artifact 详情打开弹窗
- **THEN** 看到四个有效期选项、默认无限及上述提示，创建前能理解分享范围

#### Scenario: Sensitive information already appears in prose

- **WHEN** 用户在普通正文中写入来自 Memory 或附件的敏感信息
- **THEN** UI 不宣称已经完成自动脱敏，要求分享者自行检查正文，本期不建设语义打码系统

### Requirement: Oversized or incomplete snapshots fail without publication

系统 SHALL 对创建输入、布局规模和快照总尺寸执行明确的有界校验。超过限制或无法满足必要关系完整性时 MUST 返回明确失败，不生成公开链接，也 MUST NOT 静默截断后声称已分享整个 Project。

#### Scenario: Snapshot exceeds supported size

- **WHEN** 完整白名单快照超过实现规定的尺寸上限
- **THEN** 创建失败并显示可理解的提示，不留下部分分享，不创建后台任务或自动改为实时分享
