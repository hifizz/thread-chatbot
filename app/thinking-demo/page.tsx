import type { Metadata } from "next"
import ThinkingDemo from "./thinking-demo"
import "./thinking-demo.css"

export const metadata: Metadata = { title: "AI 输出过程演示 · Thread" }

export default function ThinkingDemoPage() {
  return <ThinkingDemo />
}
