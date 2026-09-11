import { Sparkles } from "lucide-react"
import { ASSISTANT_THINKING_LABEL } from "@/constants/assistant-trace"

/** 首次等待与展开的过程标题共用同一文字流光。 */
export function ThinkingText({ title = ASSISTANT_THINKING_LABEL }: { title?: string }) {
  return <span className="assistant-trace-shimmer">{title}</span>
}

export function ThinkingStatus() {
  return <span className="assistant-thinking-status" role="status">
    <Sparkles size={16} /><ThinkingText />
  </span>
}
