import { ProjectRedirect } from "./project-redirect"
import { threadChatMetadata } from "./page-metadata"

export const metadata = threadChatMetadata

/** 裸路径入口跳板：replace 到最近 Project；没有 Project 时进入 `/new`。 */
export default function ThreadChatPage() {
  return <ProjectRedirect />
}
