import { notFound } from "next/navigation"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { NormalizedGate3Harness } from "../../thread-chat/gate-3-harness/normalized-harness"
import "../../thread-chat/thread-chat.css"

export default async function Gate3HarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ background?: string }>
}) {
  if (process.env.NODE_ENV !== "development") notFound()
  const { projectId } = await params
  if (!isValidTreeId(projectId)) notFound()
  const query = await searchParams
  return (
    <NormalizedGate3Harness
      projectId={projectId}
      backgroundRecovery={query.background === "1"}
    />
  )
}
