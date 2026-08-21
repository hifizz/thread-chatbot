"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { MarkdownBody } from "../chat/message/markdown-body"
import { ConversationComposer } from "../chat/composer/conversation-composer"
import "../thread-chat.css"
import "./canonical-thread-chat.css"
import {
  createConversationClientGateway,
  type ConversationClientGateway,
} from "@/lib/thread-chat/client/conversation-client-gateway"
import {
  createGenerationCoordinator,
  type GenerationCoordinator,
} from "@/lib/thread-chat/client/generation-coordinator"
import {
  createNormalizedConversationStore,
  canonicalGenerationRecord,
} from "@/lib/thread-chat/client/normalized-conversation-store"
import {
  deriveConversationClientIndexes,
  selectThreadLineage,
  selectThreadMessages,
  selectThreadTitle,
} from "@/lib/thread-chat/client/conversation-client-selectors"
import {
  createConversationUiWorkspaceStore,
  defaultConversationUiWorkspace,
  parseConversationUiWorkspace,
  serializeConversationUiWorkspace,
} from "@/lib/thread-chat/client/ui-workspace"
import {
  conversationId,
  generationId,
  messageId,
  threadForkId,
  threadId,
  turnId,
  type ConversationMessage,
  type ThreadId,
} from "@/lib/thread-chat/domain/conversation-model"
import type { MessageFeedback } from "@/lib/thread-chat/contracts/message-feedback"

const CanonicalThreadCanvas = dynamic(
  () =>
    import("./canonical-thread-canvas").then(
      (module) => module.CanonicalThreadCanvas
    ),
  { ssr: false, loading: () => <div className="boot-loading">画布加载中…</div> }
)
const textOf = (message: ConversationMessage) =>
  message.content.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")

export function CanonicalThreadChat({ id }: { id: string }) {
  const router = useRouter()
  const targetId = conversationId(id)
  const store = useMemo(() => createNormalizedConversationStore(), [])
  const gateway = useMemo(
    () => createConversationClientGateway({ store }),
    [store]
  )
  const coordinator = useMemo(
    () => createGenerationCoordinator({ store, gateway }),
    [gateway, store]
  )
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<
    Readonly<Record<string, MessageFeedback>>
  >({})
  const [conversationTitleDraft, setConversationTitleDraft] = useState<
    string | null
  >(null)
  const [conversationList, setConversationList] = useState<
    Awaited<ReturnType<typeof gateway.listConversations>>
  >([])
  const canonicalVersion = useSyncExternalStore(
    (fn) => store.subscribe("canonical", fn),
    () => store.snapshotForKey("canonical"),
    () => 0
  )
  const state = store.getState()
  const conversation = state.conversationsById[targetId]
  const workspaceStore = useMemo(
    () =>
      createConversationUiWorkspaceStore(
        defaultConversationUiWorkspace({
          conversationId: targetId,
          rootThreadId: threadId(`${targetId}:ui-pending-root`),
        })
      ),
    [targetId]
  )
  const workspaceHydrated = useRef(false)
  const coordinatorDisposeTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const workspace = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getState,
    workspaceStore.getState
  )

  useEffect(() => {
    if (coordinatorDisposeTimer.current) {
      clearTimeout(coordinatorDisposeTimer.current)
      coordinatorDisposeTimer.current = null
    }
    gateway.loadConversation(targetId).then(
      () => setLoaded(true),
      (cause) =>
        setError(cause instanceof Error ? cause.message : String(cause))
    )
  }, [gateway, targetId])
  useEffect(() => {
    if (!loaded) return
    void gateway.listMessageFeedback(targetId).then(
      (entries) =>
        setFeedbackByMessageId(
          Object.fromEntries(
            entries.map((entry) => [entry.messageId, entry.feedback])
          )
        ),
      (cause) =>
        setActionError(cause instanceof Error ? cause.message : String(cause))
    )
  }, [gateway, loaded, targetId])
  useEffect(() => {
    if (!conversation) return
    void gateway
      .listConversations(conversation.projectId, true)
      .then(setConversationList)
  }, [canonicalVersion, conversation, gateway])
  useEffect(() => {
    const onVisibility = () =>
      coordinator.setVisibility(
        document.visibilityState === "hidden" ? "hidden" : "visible"
      )
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      // React Strict Mode 会立即 setup → cleanup → setup；延迟释放让第二次 setup 取消它。
      coordinatorDisposeTimer.current = setTimeout(
        () => coordinator.dispose(),
        0
      )
    }
  }, [coordinator])
  useEffect(() => {
    if (!conversation) return
    const key = `thread-chat:canonical-ui:${targetId}`
    if (!workspaceHydrated.current) {
      workspaceStore.hydrate(
        parseConversationUiWorkspace({
          raw: localStorage.getItem(key),
          conversationId: targetId,
          rootThreadId: conversation.rootThreadId,
          threads: state.threadsById,
        })
      )
      workspaceHydrated.current = true
    }
    const release = workspaceStore.subscribe(() => {
      localStorage.setItem(
        key,
        serializeConversationUiWorkspace(workspaceStore.getState())
      )
    })
    return release
  }, [conversation, state.threadsById, targetId, workspaceStore])
  useEffect(() => {
    if (conversation)
      workspaceStore.reconcileThreads(
        state.threadsById,
        conversation.rootThreadId
      )
  }, [canonicalVersion, conversation, state.threadsById, workspaceStore])

  if (error)
    return (
      <div className="tc">
        <div className="boot-loading">规范 Conversation 加载失败：{error}</div>
      </div>
    )
  if (
    !loaded ||
    !conversation ||
    !workspace.visibleThreadIds.includes(conversation.rootThreadId)
  )
    return (
      <div className="tc">
        <div className="boot-loading">规范 Conversation 加载中…</div>
      </div>
    )
  const indexes = deriveConversationClientIndexes(state)
  const allThreads = indexes.threadIdsByConversation[targetId] ?? []
  const send = async (targetThreadId: ThreadId, text: string) => {
    const ids = {
      turn: turnId(crypto.randomUUID()),
      user: messageId(crypto.randomUUID()),
      assistant: messageId(crypto.randomUUID()),
      generation: generationId(crypto.randomUUID()),
    }
    workspaceStore.setDraft(targetThreadId, text)
    try {
      await gateway.sendTurn(
        targetThreadId,
        {
          conversationId: targetId,
          turnId: ids.turn,
          userMessageId: ids.user,
          assistantMessageId: ids.assistant,
          generationId: ids.generation,
          content: { schemaVersion: 1, parts: [{ type: "text", text }] },
          modelId: state.threadsById[targetThreadId]!.modelId,
        },
        {
          overlay: {
            kind: "send",
            presentationKey: ids.turn,
            threadId: targetThreadId,
            draft: text,
          },
        }
      )
      workspaceStore.setDraft(targetThreadId, "")
      coordinator.subscribe(ids.generation, () => {})
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const fork = async (
    parent: ThreadId,
    source: ConversationMessage,
    quote?: string
  ) => {
    const child = threadId(crypto.randomUUID())
    try {
      await gateway.forkThread(
        parent,
        {
          conversationId: targetId,
          forkId: threadForkId(crypto.randomUUID()),
          childThreadId: child,
          sourceMessageId: source.id,
          modelId: state.threadsById[parent]!.modelId,
          ...(quote
            ? {
                anchor: { quote: { exact: quote, prefix: "", suffix: "" } },
              }
            : {}),
        },
        {
          overlay: { kind: "fork", presentationKey: child, threadId: parent },
        }
      )
      workspaceStore.openThread(child)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const runAction = (action: Promise<unknown>) => {
    setActionError(null)
    void action.catch((cause) =>
      setActionError(cause instanceof Error ? cause.message : String(cause))
    )
  }
  const open = (target: ThreadId) => workspaceStore.openThread(target)
  return (
    <div className="tc canonical-chat">
      {actionError && (
        <div className="canonical-action-error" role="alert">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)}>关闭</button>
        </div>
      )}
      <div className="topbar">
        <button
          className="tbtn"
          onClick={() => {
            const nextConversationId = conversationId(crypto.randomUUID())
            runAction(
              gateway
                .createConversation(conversation.projectId, {
                  conversationId: nextConversationId,
                  rootThreadId: threadId(crypto.randomUUID()),
                  title: null,
                  modelId: "glm-5.3",
                })
                .then(() => {
                  router.push(`/thread-chat/${nextConversationId}`)
                })
            )
          }}
        >
          新对话
        </button>
        <details>
          <summary className="tbtn">
            对话列表 · {conversationList.length}
          </summary>
          <div className="canonical-tree-menu">
            {conversationList.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  router.push(`/thread-chat/${item.id}`)
                }}
              >
                {item.title ?? "新对话"}
                {item.lifecycle === "archived" ? "（已归档）" : ""}
              </button>
            ))}
          </div>
        </details>
        <button
          className="tbtn"
          onClick={() =>
            setConversationTitleDraft(
              conversation.customTitle ?? conversation.autoTitle ?? ""
            )
          }
        >
          重命名
        </button>
        <div className="brand">
          <span className="mark">
            {conversation.customTitle ?? conversation.autoTitle ?? "新对话"}
          </span>
        </div>
        <div className="spacer" />
        <button
          className="tbtn"
          onClick={() =>
            runAction(
              conversation.lifecycle === "active"
                ? gateway.archiveConversation(targetId)
                : gateway.restoreConversation(targetId)
            )
          }
        >
          {conversation.lifecycle === "active" ? "归档对话" : "恢复对话"}
        </button>
        <button
          className="tbtn"
          onClick={() =>
            workspaceStore.update((current) => ({
              ...current,
              viewMode: current.viewMode === "columns" ? "canvas" : "columns",
            }))
          }
        >
          {workspace.viewMode === "columns" ? "画布" : "列"}
        </button>
        <details>
          <summary className="tbtn">会话树 · {allThreads.length}</summary>
          <div className="canonical-tree-menu">
            {allThreads.map((target) => (
              <div
                className="canonical-tree-row"
                data-thread-id={target}
                key={target}
              >
                <button onClick={() => open(target)}>
                  {selectThreadTitle(state, target)}
                  {state.threadsById[target]?.lifecycle === "archived"
                    ? "（已归档）"
                    : ""}
                </button>
                {target !== conversation.rootThreadId && (
                  <button
                    onClick={() =>
                      runAction(
                        state.threadsById[target]?.lifecycle === "active"
                          ? gateway.archiveThread(target)
                          : gateway.restoreThread(target)
                      )
                    }
                  >
                    {state.threadsById[target]?.lifecycle === "active"
                      ? "归档"
                      : "恢复"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      </div>
      {conversationTitleDraft !== null && (
        <form
          className="canonical-title-editor"
          role="dialog"
          aria-label="编辑 Conversation 标题"
          onSubmit={(event) => {
            event.preventDefault()
            const title = conversationTitleDraft.trim()
            if (!title) return
            runAction(gateway.renameConversation(targetId, { title }))
            setConversationTitleDraft(null)
          }}
        >
          <label>
            Conversation 标题
            <input
              autoFocus
              value={conversationTitleDraft}
              onChange={(event) =>
                setConversationTitleDraft(event.currentTarget.value)
              }
            />
          </label>
          <button type="submit">保存</button>
          <button type="button" onClick={() => setConversationTitleDraft(null)}>
            取消
          </button>
        </form>
      )}
      {workspace.viewMode === "canvas" ? (
        <CanonicalThreadCanvas
          state={state}
          conversationId={targetId}
          onOpenThread={(target) => {
            open(target)
            workspaceStore.update((current) => ({
              ...current,
              viewMode: "columns",
            }))
          }}
        />
      ) : (
        <div className="cols">
          {workspace.visibleThreadIds.map((targetThreadId) => (
            <CanonicalColumn
              key={targetThreadId}
              threadId={targetThreadId}
              state={state}
              onOpen={open}
              onClose={() => workspaceStore.closeThread(targetThreadId)}
              onSend={(text) => void send(targetThreadId, text)}
              onFork={(message, quote) =>
                void fork(targetThreadId, message, quote)
              }
              onStop={(targetGenerationId) =>
                void gateway.stopGeneration(targetGenerationId)
              }
              gateway={gateway}
              coordinator={coordinator}
              feedbackByMessageId={feedbackByMessageId}
              onFeedback={async (message, feedback) => {
                const saved = await gateway.setMessageFeedback({
                  conversationId: targetId,
                  threadId: message.threadId,
                  messageId: message.id,
                  feedback,
                })
                setFeedbackByMessageId((current) => {
                  const next = { ...current }
                  if (saved) next[message.id] = saved.feedback
                  else delete next[message.id]
                  return next
                })
              }}
              runAction={runAction}
              onActionError={(cause) =>
                setActionError(
                  cause instanceof Error ? cause.message : String(cause)
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CanonicalColumn({
  threadId: targetThreadId,
  state,
  onOpen,
  onClose,
  onSend,
  onFork,
  onStop,
  gateway,
  coordinator,
  feedbackByMessageId,
  onFeedback,
  runAction,
  onActionError,
}: {
  threadId: ThreadId
  state: ReturnType<
    ReturnType<typeof createNormalizedConversationStore>["getState"]
  >
  onOpen: (id: ThreadId) => void
  onClose: () => void
  onSend: (text: string) => void
  onFork: (message: ConversationMessage, quote?: string) => void
  onStop: (id: ReturnType<typeof generationId>) => void
  gateway: ConversationClientGateway
  coordinator: GenerationCoordinator
  feedbackByMessageId: Readonly<Record<string, MessageFeedback>>
  onFeedback: (
    message: ConversationMessage,
    feedback: MessageFeedback | null
  ) => Promise<void>
  runAction: (action: Promise<unknown>) => void
  onActionError: (cause: unknown) => void
}) {
  const [threadTitleDraft, setThreadTitleDraft] = useState<string | null>(null)
  const thread = state.threadsById[targetThreadId]!
  const conversation = state.conversationsById[thread.conversationId]!
  const messages = selectThreadMessages(state, targetThreadId)
  const lineage = selectThreadLineage(state, targetThreadId)
  const active = Object.values(state.generationsById)
    .map(canonicalGenerationRecord)
    .find(
      (value) =>
        value?.threadId === targetThreadId &&
        ["running", "stop_requested"].includes(value.status)
    )
  return (
    <section
      className={`column ${targetThreadId === conversation.rootThreadId ? "" : "branch"}`}
      data-thread-id={targetThreadId}
    >
      <header className="col-head">
        <div className="crumb">
          {lineage.map((id, index) => (
            <span key={id}>
              <button className="seg2" onClick={() => onOpen(id)}>
                {selectThreadTitle(state, id)}
              </button>
              {index < lineage.length - 1 && <span className="chev">›</span>}
            </span>
          ))}
        </div>
        <div className="ctitle-row">
          <span className="ctitle">
            {selectThreadTitle(state, targetThreadId)}
          </span>
          {targetThreadId !== conversation.rootThreadId && (
            <>
              <button
                className="cbtn"
                onClick={() => setThreadTitleDraft(thread.localTitle ?? "")}
              >
                重命名
              </button>
              <button
                className="cbtn"
                onClick={() => runAction(gateway.archiveThread(targetThreadId))}
              >
                归档
              </button>
              <button className="cbtn" onClick={onClose}>
                关闭
              </button>
            </>
          )}
        </div>
        {threadTitleDraft !== null && (
          <form
            className="canonical-thread-title-editor"
            aria-label="编辑 Thread 标题"
            onSubmit={(event) => {
              event.preventDefault()
              const title = threadTitleDraft.trim()
              if (!title) return
              runAction(gateway.renameThread(targetThreadId, { title }))
              setThreadTitleDraft(null)
            }}
          >
            <input
              autoFocus
              aria-label="Thread 标题"
              value={threadTitleDraft}
              onChange={(event) =>
                setThreadTitleDraft(event.currentTarget.value)
              }
            />
            <button type="submit">保存</button>
            <button type="button" onClick={() => setThreadTitleDraft(null)}>
              取消
            </button>
          </form>
        )}
      </header>
      <div className="canonical-messages">
        {messages.map((message) => (
          <CanonicalMessage
            key={message.id}
            message={message}
            onFork={onFork}
            state={state}
            onOpen={onOpen}
            onEdit={async (source, text) => {
              const nextGenerationId = generationId(crypto.randomUUID())
              await gateway.editTurnInput(source.turnId, {
                conversationId: conversation.id,
                userMessageId: messageId(crypto.randomUUID()),
                assistantMessageId: messageId(crypto.randomUUID()),
                generationId: nextGenerationId,
                sourceUserMessageId: source.id,
                content: { schemaVersion: 1, parts: [{ type: "text", text }] },
                modelId: thread.modelId,
              })
              coordinator.subscribe(nextGenerationId, () => {})
            }}
            onRegenerate={async (source) => {
              const nextGenerationId = generationId(crypto.randomUUID())
              await gateway.regenerateTurn(source.turnId, {
                conversationId: conversation.id,
                assistantMessageId: messageId(crypto.randomUUID()),
                generationId: nextGenerationId,
                sourceAssistantMessageId: source.id,
                modelId: thread.modelId,
              })
              coordinator.subscribe(nextGenerationId, () => {})
            }}
            onSelect={(source) =>
              runAction(
                gateway.selectTurnVariant(source.turnId, {
                  conversationId: conversation.id,
                  messageId: source.id,
                  role: source.role as "user" | "assistant",
                })
              )
            }
            feedback={feedbackByMessageId[message.id] ?? null}
            onFeedback={(feedback) => runAction(onFeedback(message, feedback))}
            onActionError={onActionError}
          />
        ))}
      </div>
      <ConversationComposer
        variant="column"
        threadId={targetThreadId}
        isMain={targetThreadId === conversation.rootThreadId}
        busy={Boolean(active)}
        modelId={thread.modelId}
        modelSelectorDisabled
        modelSelectorDisabledReason={active ? "busy" : "branch"}
        onSend={onSend}
        onStop={() => active && onStop(active.id)}
      />
    </section>
  )
}

function CanonicalMessage({
  message,
  onFork,
  state,
  onOpen,
  onEdit,
  onRegenerate,
  onSelect,
  feedback,
  onFeedback,
  onActionError,
}: {
  message: ConversationMessage
  onFork: (message: ConversationMessage, quote?: string) => void
  state: ReturnType<
    ReturnType<typeof createNormalizedConversationStore>["getState"]
  >
  onOpen: (id: ThreadId) => void
  onEdit: (message: ConversationMessage, text: string) => Promise<void>
  onRegenerate: (message: ConversationMessage) => Promise<void>
  onSelect: (message: ConversationMessage) => void
  feedback: MessageFeedback | null
  onFeedback: (feedback: MessageFeedback | null) => void
  onActionError: (cause: unknown) => void
}) {
  const [selection, setSelection] = useState("")
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const text = textOf(message)
  const variants = Object.values(state.messagesById)
    .filter(
      (candidate) =>
        candidate.turnId === message.turnId && candidate.role === message.role
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    )
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )
  const runMessageAction = (action: Promise<unknown>) => {
    void action.catch(onActionError)
  }
  return (
    <article
      className={`message ${message.role}`}
      data-msg-id={message.id}
      onMouseUp={() =>
        setSelection(window.getSelection()?.toString().trim() ?? "")
      }
    >
      <div className="who">{message.role}</div>
      <div className="bubble">
        {message.role === "assistant" ? (
          <MarkdownBody
            source={text}
            streaming={
              message.contentState === "streaming" ||
              message.contentState === "pending"
            }
          />
        ) : (
          text
        )}
        {message.content.parts
          .filter((part) => part.type === "structured")
          .map((part, index) => (
            <CanonicalStructuredPart
              key={`${message.id}:structured:${index}`}
              kind={part.kind}
              value={part.value}
            />
          ))}
        {message.content.parts
          .filter((part) => part.type === "artifact-reference")
          .map((part) => (
            <button
              className="canonical-artifact"
              key={part.artifactId}
              onClick={() => {
                const provenance = state.artifactProvenanceById[part.artifactId]
                onOpen(provenance?.sourceThreadId ?? message.threadId)
              }}
            >
              Artifact ·{" "}
              {state.artifactProvenanceById[part.artifactId]?.title ??
                part.artifactId}
            </button>
          ))}
      </div>
      <div className="canonical-actions">
        <button
          disabled={!text}
          onClick={() =>
            runMessageAction(
              navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                if (copiedTimer.current) clearTimeout(copiedTimer.current)
                copiedTimer.current = setTimeout(() => setCopied(false), 2_000)
              })
            )
          }
        >
          {copied ? "已复制" : "复制"}
        </button>
        {message.role === "assistant" && (
          <button onClick={() => onFork(message, selection || undefined)}>
            {selection ? "从选中内容分叉" : "从此消息分叉"}
          </button>
        )}
        {message.role === "user" && (
          <button
            onClick={() => {
              const next = prompt("编辑用户输入", text)
              if (next?.trim()) runMessageAction(onEdit(message, next.trim()))
            }}
          >
            编辑
          </button>
        )}
        {message.role === "assistant" && (
          <>
            <button
              aria-pressed={feedback === "positive"}
              onClick={() =>
                onFeedback(feedback === "positive" ? null : "positive")
              }
            >
              👍{feedback === "positive" ? " 已赞" : ""}
            </button>
            <button
              aria-pressed={feedback === "negative"}
              onClick={() =>
                onFeedback(feedback === "negative" ? null : "negative")
              }
            >
              👎{feedback === "negative" ? " 已踩" : ""}
            </button>
            <button onClick={() => runMessageAction(onRegenerate(message))}>
              重新生成
            </button>
          </>
        )}
        {variants.length > 1 &&
          variants.map((variant, index) => (
            <button
              key={variant.id}
              disabled={variant.id === message.id}
              onClick={() => onSelect(variant)}
            >
              变体 {index + 1}/{variants.length}
            </button>
          ))}
      </div>
    </article>
  )
}

function CanonicalStructuredPart({
  kind,
  value,
}: {
  kind: string
  value: unknown
}) {
  const activities =
    kind === "research-activities" && Array.isArray(value) ? value : null
  if (activities)
    return (
      <section className="canonical-research" aria-label="研究活动">
        <strong>研究活动</strong>
        {activities.map((activity, index) => {
          const item =
            activity && typeof activity === "object"
              ? (activity as Record<string, unknown>)
              : {}
          return (
            <div key={String(item.id ?? index)}>
              <span>{String(item.kind ?? "研究步骤")}</span>
              <span> · {String(item.status ?? "unknown")}</span>
              {Array.isArray(item.sources) && (
                <span> · {item.sources.length} 个来源</span>
              )}
            </div>
          )
        })}
      </section>
    )
  return (
    <details className="canonical-structured">
      <summary>{kind === "research-plan" ? "研究计划" : kind}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}
