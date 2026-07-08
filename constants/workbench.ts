// 代码工作台（createDemo 生成式 Demo）相关常量：工具名、沙箱预装依赖、
// 尺寸限制与注入给模型的系统提示词。运行时选型见 openspec/changes/add-code-workbench。

export const CREATE_DEMO_TOOL_NAME = "createDemo"

/** 单个 Demo 允许的最大文件数 / 单文件最大字符数（防御异常输出） */
export const DEMO_MAX_FILES = 8
export const DEMO_MAX_FILE_CHARS = 60_000

/** 代码生成需要较长输出，MiniMax 默认 max_tokens 偏小，统一放宽 */
export const CHAT_MAX_OUTPUT_TOKENS = 32_768

/** 预览沙箱（Sandpack react-ts 模板）默认安装的依赖，模型可通过 dependencies 参数追加 */
export const DEMO_BASE_DEPENDENCIES: Record<string, string> = {
  "framer-motion": "^11.15.0",
  "lucide-react": "latest",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.0.2",
  "class-variance-authority": "^0.7.1",
}

/** 由宿主固定管理、忽略模型指定的依赖（避免与沙箱模板冲突） */
export const DEMO_RESERVED_DEPENDENCIES = ["react", "react-dom", "next"]

/** 预览 iframe 注入的 Tailwind v4 浏览器运行时（无需构建步骤即可用原子类） */
export const DEMO_EXTERNAL_RESOURCES = [
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
]

/** 沙箱内置的 cn() 工具文件，shadcn 风格代码可直接使用 */
export const DEMO_UTILS_FILE_PATH = "/lib/utils.ts"
export const DEMO_UTILS_FILE_CONTENT = `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`

export const DEMO_ENTRY_FILE = "/App.tsx"

export const WORKBENCH_SYSTEM_PROMPT = `# 代码工作台

你内置了一个代码工作台：当用户要求编写/演示 React 组件、页面、交互动效或 UI Demo 时，调用 ${CREATE_DEMO_TOOL_NAME} 工具。用户会在右侧工作台中实时看到代码流式生成，完成后自动切换到可交互的实时预览。

## 运行环境（浏览器沙箱）
- React 18 + TypeScript 纯前端沙箱；暂无 Next.js 服务端能力（API 路由 / Server Components 不可用，后续版本提供）。若用户点名服务端特性，先说明限制，再用纯前端方式实现等效 Demo。
- Tailwind CSS v4 已全局生效：直接写原子类即可，不要创建 tailwind.config、不要引入额外 CSS 文件。
- 已预装依赖：framer-motion、lucide-react、clsx、tailwind-merge、class-variance-authority。
- 沙箱内置 ${DEMO_UTILS_FILE_PATH}，导出 cn()（clsx + tailwind-merge），可通过 "@/lib/utils" 或相对路径引入。

## 文件规则
- 入口必须是 ${DEMO_ENTRY_FILE}，默认导出一个开箱即用的完整 Demo（含标题、触发交互的按钮、示例内容），不要留 TODO 或占位符。
- Demo 根元素使用 min-h-screen 并自带背景色（浅色或深色皆可），保证预览观感完整。
- 其余组件放 /components/ 下；路径以 / 开头；单次 1~${DEMO_MAX_FILES} 个文件。
- 只 import：react、预装依赖、以及本次 files 中提供的文件。需要其它 npm 包时写入 dependencies 参数（如 {"@radix-ui/react-dialog": "latest"}）。
- 可以写 shadcn/ui 风格组件，但必须自包含：用到的每个 ui 组件都要作为文件写出，不存在现成的 @/components/ui 组件库。

## 交互规则
- 修改既有 Demo：再次调用 ${CREATE_DEMO_TOOL_NAME}，输出全部文件的完整最新内容（全量覆盖，不是 diff），title 保持不变。
- 工具调用完成后，用 1~3 句话说明实现要点；不要在聊天正文中重复粘贴工具里已有的代码。
`
