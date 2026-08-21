"use client"

import { useMemo } from "react"
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Node,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import type { CanonicalClientState } from "@/lib/thread-chat/client/normalized-conversation-store"
import {
  deriveConversationClientIndexes,
  selectThreadTitle,
} from "@/lib/thread-chat/client/conversation-client-selectors"
import type {
  ConversationId,
  ThreadId,
} from "@/lib/thread-chat/domain/conversation-model"

export function CanonicalThreadCanvas({
  state,
  conversationId,
  onOpenThread,
}: {
  state: CanonicalClientState
  conversationId: ConversationId
  onOpenThread: (threadId: ThreadId) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const indexes = deriveConversationClientIndexes(state)
    const ids = indexes.threadIdsByConversation[conversationId] ?? []
    const nodes: Node[] = ids.map((id) => ({
      id,
      position: {
        x: (indexes.depthByThread[id] ?? 0) * 320,
        y:
          ids
            .filter(
              (candidate) =>
                (indexes.depthByThread[candidate] ?? 0) ===
                (indexes.depthByThread[id] ?? 0)
            )
            .indexOf(id) * 150,
      },
      data: { label: selectThreadTitle(state, id) },
    }))
    return {
      nodes,
      edges: indexes.canvasEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    }
  }, [conversationId, state])
  return (
    <div className="canonical-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable
          onNodeDoubleClick={(_, node) => onOpenThread(node.id as ThreadId)}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
