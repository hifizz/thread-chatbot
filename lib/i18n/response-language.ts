import { DEFAULT_LOCALE, type Locale } from "@/constants/i18n"

/** 稳定提示，不加入时间或随机值。仅在没有语言信号时使用界面语言。 */
export function responseLanguageInstruction(locale: Locale = DEFAULT_LOCALE): string {
  return `Follow the user's explicit response-language request first; otherwise continue in the language of the current conversation or user message. Only when neither provides a language signal, use ${locale === "zh-CN" ? "Simplified Chinese" : "English"}. The interface language does not override the user's requested language. Do not translate existing messages.`
}
