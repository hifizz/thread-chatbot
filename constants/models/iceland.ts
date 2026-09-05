import { defineProviderModels } from "@/constants/models/types"

export const icelandModels = defineProviderModels({
  id: "iceland-relay",
  name: "冰岛",
  defaults: {
    description: "冰岛预览",
    surfaces: ["thread"],
    capabilities: { imageInput: true },
    unbilledPreview: true,
  },
  models: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    {
      id: "claude-opus-4-6-thinking",
      name: "Claude Opus 4.6 Thinking",
      capabilities: { reasoning: true },
    },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    {
      id: "claude-sonnet-4-6-thinking",
      name: "Claude Sonnet 4.6 Thinking",
      capabilities: { reasoning: true },
    },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    {
      id: "claude-opus-4-7-thinking",
      name: "Claude Opus 4.7 Thinking",
      capabilities: { reasoning: true },
    },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    {
      id: "claude-opus-4-8-thinking",
      name: "Claude Opus 4.8 Thinking",
      capabilities: { reasoning: true },
    },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  ],
  toPublicModelId: (modelId) => `iceland-${modelId}`,
})
