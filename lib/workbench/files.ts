// 把模型产出的 files 参数规整成 Sandpack 可直接消费的形态：
// 路径归一化、"@/xxx" 别名改写为相对路径、补齐入口与 cn() 工具文件、合并依赖。
// 模型输出天然不可控，这里做防御性修正而不是报错，尽量让预览"能跑起来"。

import {
  DEMO_BASE_DEPENDENCIES,
  DEMO_ENTRY_FILE,
  DEMO_MAX_FILES,
  DEMO_RESERVED_DEPENDENCIES,
  DEMO_UTILS_FILE_CONTENT,
  DEMO_UTILS_FILE_PATH,
} from "@/constants/workbench"
import type { DemoFile } from "./types"

export function normalizeDemoPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/")
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

/** 计算从 fromFile 所在目录到 target（绝对路径）的相对 import 说明符 */
function relativeImport(fromFile: string, target: string): string {
  const fromDir = fromFile.split("/").filter(Boolean).slice(0, -1)
  const targetParts = target.split("/").filter(Boolean)
  let common = 0
  while (
    common < fromDir.length &&
    common < targetParts.length - 1 &&
    fromDir[common] === targetParts[common]
  ) {
    common++
  }
  const ups = fromDir.length - common
  const down = targetParts.slice(common).join("/")
  return ups === 0 ? `./${down}` : `${"../".repeat(ups)}${down}`
}

/**
 * 把文件里的 "@/xxx" 别名 import 改写成相对路径。
 * Sandpack 的打包器不认识 tsconfig paths，而模型写 shadcn 风格代码时习惯用 @/ 别名。
 */
export function rewriteAliasImports(filePath: string, content: string): string {
  return content.replace(
    /(["'])@\/([^"'\n]+)\1/g,
    (_match, quote: string, target: string) => {
      return `${quote}${relativeImport(filePath, `/${target}`)}${quote}`
    }
  )
}

/**
 * 生成 Sandpack files map。流式期间会以不完整的 files 反复调用，
 * 因此对缺失字段全部容错处理。
 */
export function toSandpackFiles(
  files: Partial<DemoFile>[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const file of (files ?? []).slice(0, DEMO_MAX_FILES)) {
    if (!file?.path || typeof file.content !== "string") continue
    const path = normalizeDemoPath(file.path)
    result[path] = rewriteAliasImports(path, file.content)
  }

  // 模型没写 cn() 工具文件时补一份，shadcn 风格代码开箱可用
  if (!result[DEMO_UTILS_FILE_PATH]) {
    result[DEMO_UTILS_FILE_PATH] = DEMO_UTILS_FILE_CONTENT
  }

  // 没有 /App.tsx 时兜底：把第一个组件文件 re-export 成入口，避免白屏
  if (!result[DEMO_ENTRY_FILE]) {
    const firstComponent = Object.keys(result).find(
      (path) => /\.(tsx|jsx)$/.test(path) && path !== DEMO_ENTRY_FILE
    )
    if (firstComponent) {
      result[DEMO_ENTRY_FILE] = `export { default } from ".${firstComponent}"\n`
    }
  }

  return result
}

/** 合并默认依赖与模型声明的依赖；react/next 等保留项由宿主固定，忽略模型指定 */
export function mergeDemoDependencies(
  fromModel: Record<string, string> | undefined
): Record<string, string> {
  const extra = Object.fromEntries(
    Object.entries(fromModel ?? {}).filter(
      ([name, version]) =>
        typeof version === "string" &&
        !DEMO_RESERVED_DEPENDENCIES.includes(name)
    )
  )
  return { ...DEMO_BASE_DEPENDENCIES, ...extra }
}
