import {
  handleCreateShare,
  handleListShares,
} from "@/lib/thread-chat/server/handlers"

export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return handleCreateShare(request)
}

export function GET(request: Request) {
  return handleListShares(request)
}
