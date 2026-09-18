/** 界面语言、设备偏好与格式化的唯一常量入口；语言不代表地理位置。 */
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_COOKIE = "tc-locale"
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60
export const LOCALE_SETTINGS_PATH = "/api/settings/locale"
export const LOCALE_LABELS: Record<Locale, string> = { "zh-CN": "简体中文", en: "English" }
