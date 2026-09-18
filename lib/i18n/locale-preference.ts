import { z } from "zod"
import { SUPPORTED_LOCALES, type Locale } from "@/constants/i18n"

export const updateLocaleSchema = z.object({ locale: z.enum(SUPPORTED_LOCALES) }).strict()
export type UpdateLocaleInput = z.infer<typeof updateLocaleSchema>
export type UpdateLocaleResult = { locale: Locale; persisted: "device" | "account"; code?: "LOCALE_SYNC_FAILED" }

/** 设备保存与账户保存分开报告，数据库失败不能伪装成跨设备同步成功。 */
export async function saveLocalePreference(
  locale: Locale,
  userId: string | null,
  persist: (userId: string, locale: Locale) => Promise<void>
): Promise<UpdateLocaleResult> {
  if (!userId) return { locale, persisted: "device" }
  try {
    await persist(userId, locale)
    return { locale, persisted: "account" }
  } catch {
    return { locale, persisted: "device", code: "LOCALE_SYNC_FAILED" }
  }
}
