## 1. 实现基线与公开契约

- [x] 1.1 在实现分支核对 main 基线与相关已合入变更，重读 AGENTS.md/CLAUDE.md 和安装版 Next 路由、缓存、proxy 文档；记录只读组件的实际复用位置
- [x] 1.2 定义 Project/Artifact 创建请求判别联合、公开快照和布局白名单契约；拒绝客户端正文、owner、任意期限以及未支持的分享粒度
- [x] 1.3 在 constants/sharing.ts 集中定义 3/7/30 天/无限选项（默认无限）、文案、token 格式及输入/快照上限；测试严格枚举与时间边界

## 2. 服务端快照构造与隐私筛选

- [x] 2.1 实现 Project 阅读数据选择：全部 Thread、当前消息、forkMessageId/forkContext 及 Markdown Artifact 来源所需最小旧消息集合；校验关联闭合与同 Project 归属
- [x] 2.2 实现逐字段公开序列化，保留必要 text/quote/已审查阅读字段，排除 Memory、Contract、Files、provider/tool metadata、内部错误与未知 parts；用嵌套秘密哨兵验证
- [x] 2.3 实现 Markdown/文本/quote/摘要/source URL 的统一地址处理与安全渲染策略，覆盖私有相对/绝对附件路由、已配置存储/签名地址、引用式 Markdown、图片、自动链接和纯文本地址
- [x] 2.4 实现独立 Markdown Artifact 快照，只接受 completed 来源，排除来源对话元信息/导航；实现 Project 内未完成消息静态占位及 stopped/failed 安全状态
- [x] 2.5 实现布局白名单规范化：有限数值/范围/大小校验、有效 Thread/Artifact ID 筛选与安全回退，不纳入草稿、recents 或模型配置
- [x] 2.6 增加纯函数测试：旧来源分支可阅读、无关旧消息不公开、跨项目/缺失关联失败、超限拒绝不截断、未知字段默认排除

## 3. 分享持久化与所有者命令

- [x] 3.1 在 lib/db/schema.ts 新增 shares 的源码定义，包含 owner/sourceProject 外键、token 唯一性、类型/时间约束及管理索引；仅对独立本地数据库 db:push，不修改 drizzle/ 文件
- [x] 3.2 实现分享仓储与 REPEATABLE READ 创建事务，在一致数据时点完成所有权校验、公开内容构造、期限计算和原子写入；失败不产生半份快照
- [x] 3.3 接入 commandId 幂等创建，验证重放不重读正文、不重发 token、不延长期限，同 ID 不同输入拒绝
- [x] 3.4 实现所有者创建/按资源列表/幂等撤销命令和私有 API；返回最小管理数据，token 不可作为管理授权
- [ ] 3.5 添加数据库与 API 测试：跨用户拒绝、源关联验证、事务一致性、所有期限和截止边界、重复撤销、来源 Project/用户删除级联失效及归档不改快照

## 4. 匿名读取与权限边界

- [x] 4.1 实现共用的有效分享查询与公开序列化，供 /api/share/[token] 及页面使用；无效/过期/撤销统一不可用，不回查源 Project/Message/Artifact/附件
- [x] 4.2 新增独立 /share/[token] 页面并精确调整 proxy.ts 的公开路径识别，保持 /thread-chat 登录 Layout 和全部私有/附件 API 的授权不变
- [x] 4.3 为页面、JSON、HTML/RSC 和 metadata 设置一致生命周期检查与动态无持久缓存行为，增加 noindex/no-referrer，不公开静态 JSON，不记录 token/正文
- [ ] 4.4 增加公开接口测试：匿名读取、各入口过期/撤销、相似私有路径不放行、token 不授予私有写入/附件访问，以及 JSON/HTML/RSC/metadata 的秘密哨兵检查

## 5. 所有者分享入口与布局捕获

- [x] 5.1 从当前列状态、画布 pins/viewport 宿主与 Artifact overlay 采集初始布局，统一真实实体 ID；不得仅取可能过期的 workspace localStorage
- [x] 5.2 在 Project 顶栏和 completed Markdown Artifact 详情接入分享弹窗，提供四个期限、默认无限、创建与复制链接，支持键盘和移动端
- [x] 5.3 在弹窗中提供已有分享列表/状态/撤销入口与快照、匿名访问、正文隐私、复制无法收回提示；删除 Project 确认中告知关联分享失效
- [ ] 5.4 测试创建失败时不展示成功链接、重复提交不重复创建、未完成/非 Markdown Artifact 不可分享，以及普通私有工作台行为不回归

## 6. 只读阅读与首屏恢复

- [x] 6.1 抽取必要的纯阅读 props/明确只读模式，新增快照阅读壳；禁止挂载 Composer、业务写命令、会话生成运行时、自动标题、恢复与订阅
- [x] 6.2 实现 Project 全部 Thread 导航、列/画布切换、引用/旧来源定位、Markdown Artifact 列表/详情与文本复制；只在快照内解析关联
- [x] 6.3 恢复列顺序/折叠/宽度/焦点、画布 pins/viewport 及 Artifact 面板，避免首次 fitView 覆盖作者布局；读者操作只改变临时状态，重新打开恢复初始布局
- [x] 6.4 实现独立 Artifact 阅读页，复用 Markdown 排版与安全链接策略，不输出私有来源入口，不自动加载图片/主动内容/附件
- [x] 6.5 完成桌面/平板/移动端适配，保留 Thread 顺序和焦点并允许阅读全部分支；遵循 .tc 语义 token 和已有表格局部滚动行为
- [ ] 6.6 增加匿名及已登录所有者浏览器测试，验证点击/快捷键均无写操作、无私有 Bootstrap/生成/附件网络请求，且不污染私有 workspace 缓存

## 7. 联合验收与回归

- [ ] 7.1 用多层分支、父来源已替换、Markdown/代码块/表格、附件哨兵、未完成消息和手动布局组成验收样本，逐项覆盖 specs/snapshot-sharing/spec.md 的场景
- [x] 7.2 验证创建后新增/编辑/重命名/重新生成/改变原布局均不影响旧链接；新分享为独立快照；其他读者操作也不改变任何快照
- [ ] 7.3 验证首次加载、刷新、直接 JSON/HTML/RSC/metadata、到期和撤销路径的缓存及隐私边界，明确已加载或复制内容不可追回
- [x] 7.4 每批业务代码修改执行 pnpm typecheck，模块完成后检查重复常量/逻辑；最终执行 lint、相关契约/数据库/浏览器测试及 OpenSpec 严格校验，不手动运行 format
- [x] 7.5 记录实现证据、尚未完成的发布依赖与限制，仅将实际通过验收的任务勾选；不把文档齐全当作功能完成

## 8. 集成发布门槛（不在功能分支生成 migration）

- [ ] 8.1 在明确的 develop 集成任务中统一生成并审查 migration，在上一版本结构的数据库验证升级；记录证据，完成前不能标记为可发布
- [ ] 8.2 部署验证后的数据库结构与应用，执行匿名分享、期限/撤销和私有权限 smoke；确认关闭公开入口的回滚步骤可用且不会删除原会话数据
