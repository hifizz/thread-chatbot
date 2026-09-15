"use client"

import { useState } from "react"
import {
  ReasoningTrace,
  SearchTrace,
  ToolTrace,
} from "@/app/thread-chat/branching/assistant/thinking-trace"
import type { WebResearchActivity } from "@/lib/chat/web-research-activity"
import "@/app/thread-chat/thread-chat.css"

/* 适配层 fixture：在 .tc 环境里直接挂载生产适配组件，
 * 覆盖流式中/完成两种状态，不发真实模型请求。 */

const REASONING_TEXT_STREAMING =
  "夏季石果类口味需求明显上升，桃子和杏子领先。\n\n应先检查蛋筒库存，再决定是否推广华夫筒特价。"

const REASONING_TEXT_LONG = Array.from(
  { length: 12 },
  (_, index) =>
    `第 ${index + 1} 段：持续流入的思考内容，用来验证最大高度、滚动阴影与贴底滚动。第 ${
      index + 1
    } 段。`
).join("\n\n")

/* Sources: paddyseed-style docs reading entries (real product data, no demo queries). */

const SEARCH_ACTIVITIES: WebResearchActivity[] = [
  {
    toolCallId: "call-1",
    kind: "search",
    status: "complete",
    query: "CopilotKit Inspector",
    sources: [
      { title: "Inspector", url: "https://docs.copilotkit.ai/inspector" },
      { title: "Quickstart", url: "https://docs.copilotkit.ai/quickstart" },
    ],
  },
  {
    toolCallId: "call-2",
    kind: "read",
    status: "running",
    url: "https://docs.copilotkit.ai/inspector",
    sources: [],
  },
]

const SEARCH_ACTIVITIES_DONE = SEARCH_ACTIVITIES.map((activity) => ({
  ...activity,
  status: "complete" as const,
}))

function FixtureSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ margin: "16px 0" }}>
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 13,
          fontWeight: 600,
          opacity: 0.7,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ThinkingTraceFixture() {
  const [reasoningState, setReasoningState] = useState<"streaming" | "done">(
    "streaming"
  )

  return (
    <div className="tc" style={{ padding: 24, maxWidth: 720 }}>
      <FixtureSection title="Reasoning · 流式中（点击切换完成，验证耗时捕获）">
        <button
          type="button"
          onClick={() =>
            setReasoningState((current) =>
              current === "streaming" ? "done" : "streaming"
            )
          }
          style={{ marginBottom: 8 }}
        >
          切换为 {reasoningState === "streaming" ? "完成" : "流式中"}
        </button>
        <ReasoningTrace
          part={{ text: REASONING_TEXT_STREAMING, state: reasoningState }}
        />
      </FixtureSection>

      <FixtureSection title="Reasoning · 超长流式（最大高度 + 滚动阴影 + 贴底）">
        <ReasoningTrace part={{ text: REASONING_TEXT_LONG, state: "streaming" }} />
      </FixtureSection>

      <FixtureSection title="Reasoning · 单句完成（轻量行）">
        <ReasoningTrace
          part={{ text: "**Verifying system date and changelog**", state: "done" }}
        />
      </FixtureSection>

      <FixtureSection title="Reasoning · 首帧即完成（历史消息）">
        <ReasoningTrace part={{ text: REASONING_TEXT_STREAMING, state: "done" }} />
      </FixtureSection>

      <FixtureSection title="Search · 检索中">
        <SearchTrace
          activities={SEARCH_ACTIVITIES}
          route={{ mode: "research", reasonCode: "multi_source_research", urls: [], suggestedQueries: [] }}
          complete={false}
        />
      </FixtureSection>

      <FixtureSection title="Search · 已完成">
        <SearchTrace
          activities={SEARCH_ACTIVITIES_DONE}
          route={{ mode: "search", reasonCode: "explicit_search", urls: [], suggestedQueries: [] }}
          complete={true}
        />
      </FixtureSection>

      <FixtureSection title="Tool · 生成中（带进度副文本）">
        <ToolTrace
          toolState="input-streaming"
          progress={{
            toolCallId: "call-3",
            phase: "streaming",
            partialTitle: "冰淇淋消费趋势报告",
            characterCount: 1240,
            lineCount: 36,
            headings: ["市场综述", "口味偏好", "渠道分布"],
          }}
        />
      </FixtureSection>

      <FixtureSection title="Tool · 已完成">
        <ToolTrace toolState="output-available" />
      </FixtureSection>
    </div>
  )
}
