import { redirect } from "next/navigation"

// 首页直接进 Thread Chat：/thread-chat 裸路径会再跳到「最近一棵」或新建的
// /thread-chat/{treeId}（见 app/thread-chat/tree-redirect.tsx）。
// 原来的 assistant-ui 线性聊天已挪到 /chat。
export default function Home() {
  redirect("/thread-chat")
}
