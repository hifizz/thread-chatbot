import { resolveConversationAuthority } from "@/lib/thread-chat/cutover/conversation-authority"

export async function GET() {
  const state = resolveConversationAuthority()
  return Response.json({
    authority: state.authority,
    schemaVersion: state.schemaVersion,
    epoch: state.epoch,
    maintenanceMode: state.maintenanceMode,
  })
}
