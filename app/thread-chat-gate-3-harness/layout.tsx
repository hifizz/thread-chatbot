import { DEFAULT_MODEL_ID, THREAD_CHAT_MODEL_OPTIONS } from "@/constants/models"
import { ModelCatalogProvider } from "@/lib/model-catalog/context"

/** 离线验收页面显式注入种子目录；生产聊天没有静态回退。 */
export default function HarnessLayout({ children }: { children: React.ReactNode }) {
  return <ModelCatalogProvider initial={{ defaultModelId: DEFAULT_MODEL_ID, models: THREAD_CHAT_MODEL_OPTIONS.map((m) => ({ ...m, logo: "auto", contextWindow: null })) }}>{children}</ModelCatalogProvider>
}
