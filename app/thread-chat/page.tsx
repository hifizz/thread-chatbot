import { TreeRedirect } from "./tree-redirect"
import { threadChatMetadata } from "./page-metadata"

export const metadata = threadChatMetadata

/** 裸路径入口跳板：replace 到「最近一棵」或新生成的 /thread-chat/{treeId} */
export default function ThreadChatPage() {
  return <TreeRedirect />
}
