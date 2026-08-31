import {
  THREAD_CHAT_AGENT_KERNEL,
  THREAD_CHAT_MARKDOWN_ARTIFACT_SYSTEM,
} from "@/constants/thread-chat"

/**
 * Compatibility builder for the legacy chat route.
 *
 * The normalized Thread Chat path uses the two-phase Prompt Compiler. Concrete
 * anchor text must be represented as a user `data-quote` after inherited
 * history, never interpolated into the system prefix. The optional arguments
 * remain accepted so old call sites do not break while migrating.
 */
export function buildThreadChatSystem(
  _anchorText?: string | null,
  _options?: { enableMarkdownArtifact?: boolean }
): string {
  return [THREAD_CHAT_AGENT_KERNEL, THREAD_CHAT_MARKDOWN_ARTIFACT_SYSTEM].join(
    "\n\n"
  )
}
