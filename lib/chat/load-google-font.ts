import {
  GOOGLE_FONT_CSS_ENDPOINT, GOOGLE_FONT_STYLE_REQUESTS, GOOGLE_FONT_TIMEOUT_MS, type GoogleFontTarget,
} from "@/constants/google-fonts"
import { restrictGoogleFontRange } from "./google-font-ranges"

const pendingFonts = new Map<string, Promise<string>>()

/** 只向固定 Google Fonts API 请求；别名隔离本站已加载的同名字体。 */
async function fetchGoogleFont(name: string, target: GoogleFontTarget): Promise<string> {
  const signal = AbortSignal.timeout(GOOGLE_FONT_TIMEOUT_MS)
  for (const styles of GOOGLE_FONT_STYLE_REQUESTS) {
    const url = new URL(GOOGLE_FONT_CSS_ENDPOINT)
    url.searchParams.set("family", name + styles)
    url.searchParams.set("display", "swap")
    const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" })
    if (response.status === 400) continue
    if (!response.ok) throw new Error("Google 字体服务暂时不可用，请稍后重试")
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(await response.text())
    const alias = `TC Google ${target} ${name}`
    const rules = Array.from(sheet.cssRules).filter((rule): rule is CSSFontFaceRule => rule.type === CSSRule.FONT_FACE_RULE).filter((rule) => {
      const range = restrictGoogleFontRange(rule.style.getPropertyValue("unicode-range"), target)
      if ((target === "english" || target === "chinese") && !range) return false
      if (range) rule.style.setProperty("unicode-range", range)
      rule.style.setProperty("font-family", `"${alias}"`)
      return true
    })
    if (!rules.length) throw new Error("该字体不支持此位置所需的文字，请选择其他应用位置")
    const style = document.createElement("style")
    style.dataset.googlePreviewFont = alias
    style.textContent = rules.map((rule) => rule.cssText).join("\n")
    document.head.append(style)
    return alias
  }
  throw new Error("未找到该字体或可用字重，请检查 Google Fonts 名称")
}

export async function loadGoogleFont(name: string, target: GoogleFontTarget, sample: string): Promise<string> {
  const key = `${target}:${name}`
  let pending = pendingFonts.get(key)
  if (!pending) {
    pending = fetchGoogleFont(name, target).catch((error) => {
      pendingFonts.delete(key)
      throw error
    })
    pendingFonts.set(key, pending)
  }
  const alias = await pending
  let timeout: ReturnType<typeof setTimeout> | undefined
  let unsupported = false
  try {
    const faces = await Promise.race([
      Promise.all([document.fonts.load(`400 16px "${alias}"`, sample), document.fonts.load(`700 16px "${alias}"`, sample)]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("字体加载超时，请检查网络后重试")), GOOGLE_FONT_TIMEOUT_MS)
      }),
    ])
    if (faces.some((matches) => matches.length === 0)) {
      unsupported = true
      throw new Error("该字体不支持此位置所需的文字，请选择其他字体或应用位置")
    }
    return alias
  } catch (error) {
    if (unsupported) throw error
    // 网络失败允许重新请求样式和字体，而不是永久缓存失败的 FontFace。
    pendingFonts.delete(key)
    document.querySelectorAll<HTMLStyleElement>("style[data-google-preview-font]").forEach((style) => {
      if (style.dataset.googlePreviewFont === alias) style.remove()
    })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
