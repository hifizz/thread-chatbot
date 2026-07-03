import type { ModelOption } from "@/components/assistant-ui/model-selector";
import { DEFAULT_MODEL_ID } from "@/constants/model";

export function docsModelOptions(): ModelOption[] {
  return [
    {
      id: DEFAULT_MODEL_ID,
      name: "MiniMax M2",
      description: "General-purpose chat model",
    },
  ];
}
