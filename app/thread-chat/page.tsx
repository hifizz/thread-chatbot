import type { Metadata } from "next";
import { ThreadChatDemo } from "./thread-chat-demo";

export const metadata: Metadata = {
  title: "Thread Chat · 分支对话",
  description: "划选 AI 回复文字即可开分支的树状对话，接入 MiniMax 实时流式回复。",
};

export default function ThreadChatPage() {
  return <ThreadChatDemo />;
}
