// 首页核心演示的本地文案与尺寸常量；真实工作台的语义来源见各条注释。
export const DEMO_BRANCH_LABEL = "在当前对话问";
export const DEMO_BRANCH_LABEL_TITLE = "引用这段内容，在当前对话中继续提问";
export const DEMO_FORK_LABEL = "此处提问";
export const DEMO_FORK_LABEL_TITLE = "围绕这段内容，单独展开提问";
export const DEMO_BUBBLE_TITLE = "在新分支中讨论这段";
export const DEMO_QUESTION_PLACEHOLDER = "就这段问点什么…（可留空）";
export const DEMO_SUBMIT_IDLE = "开启分支讨论";
export const DEMO_SUBMIT_WITH_QUESTION = "带着问题开分支";
export const DEMO_COMPOSER_PLACEHOLDER = "输入问题，@ 引用 Artifact";
export const DEMO_MODEL_LOCKED_REASON = "非主线分支暂不支持修改模型和生成参数，请在主线中调整";
export const DEMO_VOICE_TITLE = "语音输入稍后接入";
export const DEMO_SUBTREE_LABEL = "查看子分支";
export const DEMO_SWITCH_LABEL = "⇄ 切换";
export const DEMO_COL_TITLE_MAIN = "主线";
export const DEMO_ANCHOR_TAG = "锚定";
export const DEMO_CRUMB_ROOT = "主线";
export const DEMO_FOCUS_LABEL = "讨论焦点";
export const DEMO_INHERITED_LABEL = "继承的上文";
export const DEMO_WHO_YOU = "你";
export const DEMO_WHO_AI = "AI";
export const DEMO_NEW_CHAT = "新对话";
export const DEMO_TREE_LIST = "对话列表";
export const DEMO_COLUMNS_VIEW = "列";
export const DEMO_CANVAS_VIEW = "画布";
export const DEMO_CANVAS_ONLY_COLUMNS = "演示仅提供列视图";
export const DEMO_AUTO_COLS = "自适应";
export const DEMO_THREAD_TREE = "会话树";
export const DEMO_PROJECT = "Project";
export const DEMO_MODE_REPLACE = "替换⑥";
export const DEMO_MODE_FOLD = "细条⑤";
export const DEMO_SCROLL_END_LABEL = "回到最新";
export const DEMO_MESSAGE_TOOLBAR_LABEL = "消息操作";
export const DEMO_COPY_LABEL = "复制";
export const DEMO_COPIED_LABEL = "已复制";
export const DEMO_REGENERATE_LABEL = "重新生成";
export const DEMO_POSITIVE_LABEL = "点赞";
export const DEMO_NEGATIVE_LABEL = "点踩";
export const DEMO_REGENERATE_ONLY_LATEST = "仅支持重新生成当前最后一轮";
export const DEMO_EDIT_ONLY_LATEST = "仅支持编辑当前最后一轮";
export const DEMO_NO_MARKDOWN = "该回复没有可复制的 Markdown 正文";
export const DEMO_FEEDBACK_FAILED = "反馈保存失败，请重试";
export const DEMO_COPY_FAILED = "复制失败，请检查浏览器剪贴板权限";
export const DEMO_LOCAL_REPLY =
  "当前体验支持示例中的问题。点击划线的原句继续追问，或切换一个感兴趣的场景。";
export const DEMO_MANUAL_HINT = "已暂停自动演示，你可以自由探索。";
export const DEMO_AUTO_HINT = "也可以点击原句，亲手开启一个分支。";
export const DEMO_PLACEMENT_DEFAULT_APPEND = "将在右侧新开一列";
export const DEMO_KEEP_SOURCE_HINT = "⌘ 保留本列 · 新列开在紧邻右侧";
export const DEMO_RESIZER_LABEL = "拖动调整两侧列宽 · 双击恢复均分";
export const DEMO_ARTIFACT_KIND_LABEL = "MARKDOWN";
export const DEMO_ARTIFACT_OPEN_LABEL = "打开预览 →";
export const DEMO_ARTIFACT_GENERATING = "正在生成 Markdown";
/** 演示用 Artifact：标题与正文是卡片、生成占位、@ 引用菜单共用的唯一来源。 */
export const DEMO_ARTIFACT = {
  title: "分支结论引用方案",
  kindLabel: DEMO_ARTIFACT_KIND_LABEL,
  sourceLabel: "来自「避免重复传递内容」",
  content: [
    "# 分支结论引用方案",
    "",
    "- 主动引用：主线通过 @ 选择要带回的结论。",
    "- 保留来源：胶囊记录 Artifact 出处，可随时移除。",
    "- 避免重复注入：正文已在上下文时只保留稳定引用标记。",
  ].join("\n"),
} as const;
/** 生成占位卡展示的进度比例（确定为 0.6，避免每帧计数带来的抖动）。 */
export const DEMO_ARTIFACT_PARTIAL_RATIO = 0.6;
export const DEMO_MODEL_FALLBACK_NAME = "GPT-5.6 Luna";

/** 提问气泡宽度：与真实划选气泡 BUBBLE_W 对齐。 */
export const DEMO_BUBBLE_W = 260;
/** 气泡与选区的安全边距：与真实 BUBBLE_SAFE_PADDING 对齐。 */
export const DEMO_BUBBLE_SAFE_PADDING = 12;
/** 用户消息过长时的折叠行数。 */
export const DEMO_USER_MESSAGE_COLLAPSED_LINES = 6;
