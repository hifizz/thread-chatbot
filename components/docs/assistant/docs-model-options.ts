import type { ModelOption } from "@/components/assistant-ui/model-selector";
import { CHAT_MODELS } from "@/constants/model";

// 模型选项统一从注册表（constants/model.ts）派生，避免与输入框选择器出现两份定义。
export function docsModelOptions(): ModelOption[] {
  return CHAT_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
  }));
}
