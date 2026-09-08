import type { ModelOption } from "@/components/assistant-ui/model-selector";
import { AVAILABLE_MODELS } from "@/constants/models";

// 模型选项统一从注册表（constants/models）派生，避免与输入框选择器出现两份定义。
export function docsModelOptions(): ModelOption[] {
  return AVAILABLE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
  }));
}
