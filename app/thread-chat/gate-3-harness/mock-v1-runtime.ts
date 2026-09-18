import { artifactReferenceData } from "@/lib/thread-chat/contracts/artifact-reference"
import { messageContentToUiParts, type MessageContentInput } from "@/lib/thread-chat/contracts/message-content"

import type {
  ArtifactDTO,
  GenerationAcceptedDTO,
  MessageDTO,
  ProjectBootstrapDTO,
  ProjectDTO,
  ThreadDTO,
} from "@/lib/thread-chat/contracts/dto"
import type {
  DocumentDTO,
  DocumentListItemDTO,
  DocumentRevisionDTO,
  UpdateDocumentInput,
  UpdateDocumentResult,
} from "@/lib/thread-chat/contracts/document"
import { PROJECT_TITLE_FALLBACK } from "@/constants/project-workspace"
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/models"
import { textFromMessageParts, type ThreadChatUIMessageChunk } from "@/lib/thread-chat/contracts/ui-message"
import type { ThreadChatClient } from "../net/client"

export type Gate3HarnessScenario =
  | "normal" | "late-sse" | "disconnect" | "failure" | "artifact" | "research"
  | "document-commit" | "document-retry" | "document-unchanged"
  | "document-conflict" | "document-rejected" | "document-error"

const DOCUMENT_SCENARIOS: ReadonlySet<Gate3HarnessScenario> = new Set([
  "document-commit", "document-retry", "document-unchanged",
  "document-conflict", "document-rejected", "document-error",
])

const ROOT_THREAD_ID = "00000000-0000-4000-8000-000000000010"
const CHILD_THREAD_ID = "00000000-0000-4000-8000-000000000020"
const NESTED_THREAD_ID = "00000000-0000-4000-8000-000000000030"
const ROOT_USER_ID = "00000000-0000-4000-8000-000000000101"
const ROOT_ASSISTANT_ID = "00000000-0000-4000-8000-000000000102"
const CHILD_USER_ID = "00000000-0000-4000-8000-000000000201"
const CHILD_ASSISTANT_ID = "00000000-0000-4000-8000-000000000202"
const INITIAL_ARTIFACT_ID = "00000000-0000-4000-8000-000000000401"
const BACKGROUND_USER_ID = "00000000-0000-4000-8000-000000000501"
const BACKGROUND_ASSISTANT_ID = "00000000-0000-4000-8000-000000000502"
const DEMO_DOCUMENT_ID = "00000000-0000-4000-8000-000000000601"
const DEMO_DOCUMENT_TITLE = "Gate 3 演示文档"
const DEMO_CONCURRENT_MESSAGE_ID = "00000000-0000-4000-8000-000000000720"
const MODEL_ID = DEFAULT_THREAD_CHAT_MODEL_ID
const DEMO_REVISION_COUNT = 5
const DEMO_MESSAGE_SEQUENCES = 14

const demoRevisionId = (n: number) =>
  `00000000-0000-4000-8000-000000000${610 + n}`
const demoArtifactId = (n: number) =>
  `00000000-0000-4000-8000-000000000${620 + n}`
const demoMessageId = (n: number) =>
  `00000000-0000-4000-8000-000000000${700 + n}`
const demoReadId = (n: number) =>
  `00000000-0000-4000-8000-000000000${740 + n}`

function clone<T>(value: T): T {
  return structuredClone(value)
}

function now(): string {
  return new Date().toISOString()
}

function textOf(message: MessageDTO): string {
  return textFromMessageParts(message.parts)
}

function commandResponse<T>(data: T) {
  return { ok: true as const, replayed: false, data }
}

type DemoParts = MessageDTO["parts"]

/* 文档工具演示 fixture：一份 5 版本文档 + 主线 6 组对话，覆盖 committed /
 * 冲突重试 / unchanged / 终态 conflict / rejected / output-error 全部结果态。 */
function demoDocumentDto(projectId: string, currentRevisionId: string): DocumentDTO {
  return { id: DEMO_DOCUMENT_ID, projectId, currentRevisionId, title: DEMO_DOCUMENT_TITLE }
}

function demoFindPart(
  projectId: string,
  toolCallId: string,
  currentRevisionId: string
): DemoParts[number] {
  return {
    type: "tool-findProjectDocuments",
    toolCallId,
    state: "output-available",
    input: { query: DEMO_DOCUMENT_TITLE },
    output: [demoDocumentDto(projectId, currentRevisionId)],
  }
}

function demoReadPart(
  projectId: string,
  toolCallId: string,
  revision: DocumentRevisionDTO,
  options: {
    readId: string
    isCurrent: boolean
    currentRevisionId: string
    pinned?: boolean
  }
): DemoParts[number] {
  return {
    type: "tool-readProjectDocument",
    toolCallId,
    state: "output-available",
    input: {
      documentId: DEMO_DOCUMENT_ID,
      ...(options.pinned ? { revisionId: revision.id } : {}),
    },
    output: {
      document: demoDocumentDto(projectId, options.currentRevisionId),
      revision,
      readId: options.readId,
      isCurrent: options.isCurrent,
    },
  }
}

function demoUpdateInput(
  expectedRevisionId: string,
  readId: string,
  changeSummary: string,
  edit: { oldText: string; newText: string }
): UpdateDocumentInput {
  return {
    documentId: DEMO_DOCUMENT_ID,
    expectedRevisionId,
    readId,
    changeSummary,
    edits: [edit],
  }
}

function demoUpdatePart(
  toolCallId: string,
  input: UpdateDocumentInput,
  output: UpdateDocumentResult
): DemoParts[number] {
  return {
    type: "tool-updateProjectDocument",
    toolCallId,
    state: "output-available",
    input,
    output,
  }
}

function demoUpdateErrorPart(
  toolCallId: string,
  input: UpdateDocumentInput,
  errorText: string
): DemoParts[number] {
  return {
    type: "tool-updateProjectDocument",
    toolCallId,
    state: "output-error",
    input,
    errorText,
  }
}

function demoTextPart(text: string): DemoParts[number] {
  return { type: "text", text, state: "done" }
}

function demoArtifactForRevision(
  projectId: string,
  revision: DocumentRevisionDTO
): ArtifactDTO {
  const onRoot = revision.sourceThreadId === ROOT_THREAD_ID
  return {
    id: revision.artifactId,
    projectId,
    threadId: revision.sourceThreadId,
    sourceMessageId: revision.sourceMessageId,
    sourceThreadTitle: onRoot ? "规范化会话验收" : "断流恢复",
    sourceThreadFootnote: onRoot ? null : 1,
    sourceMessageStatus: "completed",
    kind: "markdown",
    title: revision.title,
    content: revision.content,
    language: null,
    metadata: {},
    createdAt: revision.createdAt,
    updatedAt: revision.createdAt,
    document: {
      id: DEMO_DOCUMENT_ID,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
    },
  }
}

interface DocumentDemoFixture {
  document: DocumentListItemDTO
  revisions: DocumentRevisionDTO[]
  artifacts: ArtifactDTO[]
  messages: MessageDTO[]
}

/** 把终态 parts 还原成标准 UI message chunk 序列（tool-input-available →
 * tool-output-* / text-start-delta-end），供 mock SSE 逐步发送。 */
function partsToStreamChunks(
  parts: MessageDTO["parts"]
): ThreadChatUIMessageChunk[] {
  const chunks: ThreadChatUIMessageChunk[] = []
  for (const part of parts) {
    if (part.type.startsWith("tool-") && "toolCallId" in part) {
      chunks.push({
        type: "tool-input-available",
        toolCallId: part.toolCallId,
        toolName: part.type.slice("tool-".length),
        input: part.input,
      })
      if (part.state === "output-available")
        chunks.push({
          type: "tool-output-available",
          toolCallId: part.toolCallId,
          output: part.output,
        })
      else if (part.state === "output-error")
        chunks.push({
          type: "tool-output-error",
          toolCallId: part.toolCallId,
          errorText: part.errorText,
        })
      continue
    }
    if (part.type === "text") {
      const id = `text-${chunks.length}`
      chunks.push(
        { type: "text-start", id },
        { type: "text-delta", id, delta: part.text },
        { type: "text-end", id }
      )
    }
  }
  return chunks
}

function createDocumentDemoFixture(projectId: string): DocumentDemoFixture {
  const stamp = now()
  const v1 =
    "# Gate 3 演示文档\n\n## 1. 写作约定\n\n- 标题简洁\n- 先结论后细节\n\n## 2. 待办\n\n- [ ] 确定评分方案"
  const v2 = `${v1}\n- [ ] 校对标题层级`
  const v3 = v2.replace("## 1. 写作约定", "## 1. 团队写作准则")
  const v4 = v3.replace("## 2. 待办", "## 2. 评测维度与待办")
  const v5 = v4.replace(
    "- [ ] 校对标题层级",
    "- [ ] 校对标题层级\n- [ ] 引用质量逐条核对"
  )
  const provenance = [
    { changeSummary: "创建初始版本", threadId: ROOT_THREAD_ID, messageId: ROOT_ASSISTANT_ID },
    { changeSummary: "补充 TODO 校对项", threadId: ROOT_THREAD_ID, messageId: ROOT_ASSISTANT_ID },
    { changeSummary: "修改第 1 节标题为「团队写作准则」", threadId: ROOT_THREAD_ID, messageId: demoMessageId(2) },
    { changeSummary: "第 2 节更名「评测维度与待办」", threadId: CHILD_THREAD_ID, messageId: DEMO_CONCURRENT_MESSAGE_ID },
    { changeSummary: "TODO 补充「引用质量」核对项", threadId: ROOT_THREAD_ID, messageId: demoMessageId(4) },
  ]
  const revisions: DocumentRevisionDTO[] = [v1, v2, v3, v4, v5].map(
    (content, index) => {
      const n = index + 1
      const source = provenance[index]
      return {
        id: demoRevisionId(n),
        documentId: DEMO_DOCUMENT_ID,
        revisionNumber: n,
        parentRevisionId: n > 1 ? demoRevisionId(n - 1) : null,
        artifactId: demoArtifactId(n),
        title: DEMO_DOCUMENT_TITLE,
        sourceThreadId: source.threadId,
        sourceMessageId: source.messageId,
        sourceMessageStatus: "completed",
        changeSummary: source.changeSummary,
        content,
        createdAt: stamp,
      }
    }
  )
  const rev = (n: number) => revisions[n - 1]
  const artifacts = revisions.map((revision) =>
    demoArtifactForRevision(projectId, revision)
  )
  const latest = revisions[DEMO_REVISION_COUNT - 1]
  const document: DocumentListItemDTO = {
    id: DEMO_DOCUMENT_ID,
    projectId,
    currentRevisionId: latest.id,
    title: DEMO_DOCUMENT_TITLE,
    revisionNumber: latest.revisionNumber,
    sourceMessageStatus: "completed",
    currentArtifactId: latest.artifactId,
    sourceThreadId: ROOT_THREAD_ID,
    sourceMessageId: demoMessageId(4),
  }
  const done = (
    id: string,
    sequence: number,
    role: "user" | "assistant",
    parts: DemoParts
  ): MessageDTO => ({
    id,
    projectId,
    threadId: ROOT_THREAD_ID,
    sequence,
    role,
    parts,
    status: "completed",
    modelId: role === "assistant" ? MODEL_ID : null,
    replacesMessageId: null,
    supersededAt: null,
    feedback: null,
    error: null,
    createdAt: stamp,
    updatedAt: stamp,
    finishedAt: stamp,
  })
  const userText = (text: string): DemoParts => [{ type: "text", text }]
  const todoEdit = {
    oldText: "- [ ] 校对标题层级",
    newText: "- [ ] 校对标题层级\n- [ ] 引用质量逐条核对",
  }
  const messages: MessageDTO[] = [
    // 成功：find → read V2 → committed V3，出可点击结果卡
    done(demoMessageId(1), 3, "user", userText("把「Gate 3 演示文档」第 1 节标题改成「团队写作准则」")),
    done(demoMessageId(2), 4, "assistant", [
      demoFindPart(projectId, "demo-a-find", rev(2).id),
      demoReadPart(projectId, "demo-a-read", rev(2), {
        readId: demoReadId(1),
        isCurrent: true,
        currentRevisionId: rev(2).id,
      }),
      demoUpdatePart(
        "demo-a-update",
        demoUpdateInput(demoRevisionId(2), demoReadId(1), "修改第 1 节标题为「团队写作准则」", {
          oldText: "## 1. 写作约定",
          newText: "## 1. 团队写作准则",
        }),
        {
          status: "committed",
          documentId: DEMO_DOCUMENT_ID,
          previousRevisionId: demoRevisionId(2),
          revisionId: demoRevisionId(3),
          artifactId: demoArtifactId(3),
          changeSummary: "修改第 1 节标题为「团队写作准则」",
        }
      ),
      demoTextPart("已将第 1 节标题更新为「团队写作准则」，保存为 V3。"),
    ]),
    // 冲突重试：中间 conflict 只留在轨迹行，最终 committed 出卡
    done(demoMessageId(3), 5, "user", userText("TODO 里再补一条「引用质量」核对项")),
    done(demoMessageId(4), 6, "assistant", [
      demoFindPart(projectId, "demo-b-find", rev(3).id),
      demoReadPart(projectId, "demo-b-read-1", rev(3), {
        readId: demoReadId(2),
        isCurrent: true,
        currentRevisionId: rev(3).id,
      }),
      demoUpdatePart(
        "demo-b-update-1",
        demoUpdateInput(demoRevisionId(3), demoReadId(2), "TODO 补充「引用质量」核对项", todoEdit),
        {
          status: "conflict",
          code: "DOCUMENT_CHANGED",
          documentId: DEMO_DOCUMENT_ID,
          currentRevisionId: demoRevisionId(4),
          requiresRead: true,
        }
      ),
      demoReadPart(projectId, "demo-b-read-2", rev(4), {
        readId: demoReadId(3),
        isCurrent: true,
        currentRevisionId: rev(4).id,
      }),
      demoUpdatePart(
        "demo-b-update-2",
        demoUpdateInput(demoRevisionId(4), demoReadId(3), "TODO 补充「引用质量」核对项", todoEdit),
        {
          status: "committed",
          documentId: DEMO_DOCUMENT_ID,
          previousRevisionId: demoRevisionId(4),
          revisionId: demoRevisionId(5),
          artifactId: demoArtifactId(5),
          changeSummary: "TODO 补充「引用质量」核对项",
        }
      ),
      demoTextPart("提交时检测到并发修改（V4），已按最新版本重新提交，保存为 V5。"),
    ]),
    // unchanged：静态收据「内容已满足要求，无需修改」
    done(demoMessageId(5), 7, "user", userText("把第 1 节标题改成「团队写作准则」")),
    done(demoMessageId(6), 8, "assistant", [
      demoFindPart(projectId, "demo-c-find", rev(5).id),
      demoReadPart(projectId, "demo-c-read", rev(5), {
        readId: demoReadId(4),
        isCurrent: true,
        currentRevisionId: rev(5).id,
      }),
      demoUpdatePart(
        "demo-c-update",
        demoUpdateInput(demoRevisionId(5), demoReadId(4), "修改第 1 节标题为「团队写作准则」", {
          oldText: "## 1. 团队写作准则",
          newText: "## 1. 团队写作准则",
        }),
        { status: "unchanged", documentId: DEMO_DOCUMENT_ID, revisionId: demoRevisionId(5) }
      ),
      demoTextPart("第 1 节标题已经是「团队写作准则」，内容已满足要求，无需重复保存。"),
    ]),
    // 终态冲突：读取旧版（非最新行）→ conflict 静态失败卡
    done(demoMessageId(7), 9, "user", userText("把第 2 节标题改成「评测标准」")),
    done(demoMessageId(8), 10, "assistant", [
      demoFindPart(projectId, "demo-d-find", rev(5).id),
      demoReadPart(projectId, "demo-d-read", rev(4), {
        readId: demoReadId(5),
        isCurrent: false,
        currentRevisionId: rev(5).id,
        pinned: true,
      }),
      demoUpdatePart(
        "demo-d-update",
        demoUpdateInput(demoRevisionId(4), demoReadId(5), "修改第 2 节标题为「评测标准」", {
          oldText: "## 2. 评测维度与待办",
          newText: "## 2. 评测标准",
        }),
        {
          status: "conflict",
          code: "DOCUMENT_CHANGED",
          documentId: DEMO_DOCUMENT_ID,
          currentRevisionId: demoRevisionId(5),
          requiresRead: true,
        }
      ),
      demoTextPart("提交时文档已更新到 V5，本次未保存。如需继续修改请重试，我会先读取最新版本。"),
    ]),
    // rejected：SOURCE_NOT_FOUND 静态失败卡
    done(demoMessageId(9), 11, "user", userText("删掉「不存在的章节」一节")),
    done(demoMessageId(10), 12, "assistant", [
      demoFindPart(projectId, "demo-e-find", rev(5).id),
      demoReadPart(projectId, "demo-e-read", rev(5), {
        readId: demoReadId(6),
        isCurrent: true,
        currentRevisionId: rev(5).id,
      }),
      demoUpdatePart(
        "demo-e-update",
        demoUpdateInput(demoRevisionId(5), demoReadId(6), "删除「不存在的章节」一节", {
          oldText: "## 9. 不存在的章节\n\n（正文）",
          newText: "",
        }),
        { status: "rejected", code: "SOURCE_NOT_FOUND" }
      ),
      demoTextPart("未在原文中找到目标章节，本次未保存。"),
    ]),
    // output-error：通用失败卡，不露 errorText
    done(demoMessageId(11), 13, "user", userText("把文档标题改成「评测计划」")),
    done(demoMessageId(12), 14, "assistant", [
      demoFindPart(projectId, "demo-f-find", rev(5).id),
      demoReadPart(projectId, "demo-f-read", rev(5), {
        readId: demoReadId(7),
        isCurrent: true,
        currentRevisionId: rev(5).id,
      }),
      demoUpdateErrorPart(
        "demo-f-update",
        demoUpdateInput(demoRevisionId(5), demoReadId(7), "修改文档标题为「评测计划」", {
          oldText: "# Gate 3 演示文档",
          newText: "# 评测计划",
        }),
        "DOCUMENT_STORE_TIMEOUT"
      ),
      demoTextPart("保存时发生错误，请稍后重试。"),
    ]),
  ]
  return { document, revisions, artifacts, messages }
}

function initialBootstrap(
  projectId: string,
  options: { backgroundRecovery?: boolean } = {}
): Omit<ProjectBootstrapDTO, "artifacts"> & { artifacts: ArtifactDTO[] } {
  const stamp = now()
  const project: ProjectDTO = {
    id: projectId,
    rootThreadId: ROOT_THREAD_ID,
    autoTitle: "规范化会话验收",
    customTitle: null,
    target: null,
    instructions: null,
    contractVersion: 0,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const root: ThreadDTO = {
    id: ROOT_THREAD_ID,
    projectId,
    parentId: null,
    forkMessageId: null,
    forkArtifactId: null,
    forkContext: [],
    forkAnchor: null,
    anchorText: null,
    footnote: null,
    depth: 0,
    modelId: MODEL_ID,
    autoTitle: "规范化会话验收",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const child: ThreadDTO = {
    id: CHILD_THREAD_ID,
    projectId,
    parentId: ROOT_THREAD_ID,
    forkMessageId: ROOT_ASSISTANT_ID,
    forkArtifactId: null,
    forkContext: [ROOT_USER_ID, ROOT_ASSISTANT_ID],
    forkAnchor: {
      quote: {
        exact: "HTTP 连接断开不能拥有模型任务",
        prefix: "关键原则是：",
        suffix: "。这使刷新和断流都可恢复。",
      },
    },
    anchorText: "HTTP 连接断开不能拥有模型任务",
    footnote: 1,
    depth: 1,
    modelId: MODEL_ID,
    autoTitle: "断流恢复",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const nested: ThreadDTO = {
    id: NESTED_THREAD_ID,
    projectId,
    parentId: CHILD_THREAD_ID,
    forkMessageId: CHILD_ASSISTANT_ID,
    forkArtifactId: null,
    forkContext: [
      ROOT_USER_ID,
      ROOT_ASSISTANT_ID,
      CHILD_USER_ID,
      CHILD_ASSISTANT_ID,
    ],
    forkAnchor: {
      quote: {
        exact: "只轮询，不重新连接 SSE",
        prefix: "刷新后",
        suffix: "。",
      },
    },
    anchorText: "只轮询，不重新连接 SSE",
    footnote: 2,
    depth: 2,
    modelId: MODEL_ID,
    autoTitle: "后台轮询",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const messages: MessageDTO[] = [
    {
      id: ROOT_USER_ID,
      projectId,
      threadId: ROOT_THREAD_ID,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "说明新会话架构为什么能应对断流。" }],
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: ROOT_ASSISTANT_ID,
      projectId,
      threadId: ROOT_THREAD_ID,
      sequence: 2,
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "先区分模型任务、SSE 连接和数据库终态。",
          state: "done",
        },
        {
          type: "text",
          text: "关键原则是：HTTP 连接断开不能拥有模型任务。这使刷新和断流都可恢复。",
          state: "done",
        },
        {
          type: "data-research-activity",
          id: "research-initial",
          data: {
            toolCallId: "search-initial",
            kind: "search",
            status: "complete",
            query: "AI SDK UI Message stream",
            sources: [{ title: "AI SDK", url: "https://ai-sdk.dev/docs" }],
          },
        },
        {
          type: "source-url",
          sourceId: "source-initial",
          url: "https://ai-sdk.dev/docs",
          title: "AI SDK 文档",
        },
      ],
      status: "completed",
      modelId: MODEL_ID,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: CHILD_USER_ID,
      projectId,
      threadId: CHILD_THREAD_ID,
      sequence: 1,
      role: "user",
      parts: [{ type: "text", text: "刷新后具体怎么处理？" }],
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
    {
      id: CHILD_ASSISTANT_ID,
      projectId,
      threadId: CHILD_THREAD_ID,
      sequence: 2,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "刷新后只轮询，不重新连接 SSE；终态返回后再一次性收敛完整 parts。",
          state: "done",
        },
      ],
      status: "completed",
      modelId: MODEL_ID,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    },
  ]
  if (options.backgroundRecovery) {
    messages.push(
      {
        id: BACKGROUND_USER_ID,
        projectId,
        threadId: ROOT_THREAD_ID,
        sequence: DEMO_MESSAGE_SEQUENCES + 1,
        role: "user",
        parts: [{ type: "text", text: "刷新后恢复后台生成" }],
        status: "completed",
        modelId: null,
        replacesMessageId: null,
        supersededAt: null,
        feedback: null,
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
        finishedAt: stamp,
      },
      {
        id: BACKGROUND_ASSISTANT_ID,
        projectId,
        threadId: ROOT_THREAD_ID,
        sequence: DEMO_MESSAGE_SEQUENCES + 2,
        role: "assistant",
        parts: [
          { type: "text", text: "刷新前 checkpoint", state: "streaming" },
        ],
        status: "generating",
        modelId: MODEL_ID,
        replacesMessageId: null,
        supersededAt: null,
        feedback: null,
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
        finishedAt: null,
      }
    )
  }
  const artifact: ArtifactDTO = {
    id: INITIAL_ARTIFACT_ID,
    projectId,
    threadId: ROOT_THREAD_ID,
    sourceMessageId: ROOT_ASSISTANT_ID,
    sourceThreadTitle: "规范化会话验收",
    sourceThreadFootnote: null,
    sourceMessageStatus: "completed",
    kind: "markdown",
    title: "断流恢复验收清单",
    content:
      "# 断流恢复验收清单\n\n- 模型任务独立于 HTTP\n- SSE 只连接一次\n- 断开后轮询终态",
    language: null,
    metadata: {},
    createdAt: stamp,
    updatedAt: stamp,
  }
  return {
    project,
    files: [],
    threads: [root, child, nested],
    messages,
    documents: [],
    artifacts: [artifact],
    activeGenerationIds: options.backgroundRecovery
      ? [BACKGROUND_ASSISTANT_ID]
      : [],
  }
}

export function createGate3MockRuntime(
  projectId: string,
  options: { backgroundRecovery?: boolean } = {}
) {
  const seed = initialBootstrap(projectId, options)
  const documentDemo = createDocumentDemoFixture(projectId)
  seed.documents.push(documentDemo.document)
  seed.artifacts.push(...documentDemo.artifacts)
  seed.messages.push(...documentDemo.messages)
  let project = clone(seed.project)
  const threads = new Map(
    seed.threads.map((thread) => [thread.id, clone(thread)])
  )
  const messages = new Map(
    seed.messages.map((message) => [message.id, clone(message)])
  )
  const artifacts = new Map(
    seed.artifacts.map((artifact) => [artifact.id, clone(artifact)])
  )
  const documents = new Map([[documentDemo.document.id, clone(documentDemo.document)]])
  const revisions = new Map(
    documentDemo.revisions.map((revision) => [revision.id, clone(revision)])
  )
  /* 流式按 chunk 逐步发出的 parts 与终态必须一致；先构建后缓存，
   * 供 fetchStream 与 finalMessage（含轮询路径）共用。 */
  const documentPartsByMessageId = new Map<string, MessageDTO["parts"]>()
  const userParts = (content: MessageContentInput) => messageContentToUiParts(content, (id) => {
    const artifact = artifacts.get(id)
    if (!artifact) throw new Error("引用的 Artifact 不存在")
    return artifactReferenceData(artifact)
  })

  const scenarioByMessageId = new Map<string, Gate3HarnessScenario>()
  const backgroundPolls = new Map<string, number>()
  for (const messageId of seed.activeGenerationIds)
    scenarioByMessageId.set(messageId, "normal")
  let selectedScenario: Gate3HarnessScenario = "normal"

  const bootstrap = (): ProjectBootstrapDTO => ({
    project: clone(project),
    files: [],
    threads: [...threads.values()].map(clone),
    messages: [...messages.values()].map(clone),
    documents: [...documents.values()].map(clone),
    artifacts: [...artifacts.values()].map(clone),
    activeGenerationIds: [...messages.values()]
      .filter((message) => message.status === "generating")
      .map((message) => message.id),
  })

  const nextSequence = (threadId: string) =>
    Math.max(
      0,
      ...[...messages.values()]
        .filter((message) => message.threadId === threadId)
        .map((message) => message.sequence)
    ) + 1

  const makeUser = (input: {
    id: string
    threadId: string
    sequence: number
    parts: MessageDTO["parts"]
  }): MessageDTO => {
    const stamp = now()
    return {
      id: input.id,
      projectId,
      threadId: input.threadId,
      sequence: input.sequence,
      role: "user",
      parts: input.parts,
      status: "completed",
      modelId: null,
      replacesMessageId: null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: stamp,
    }
  }

  const makeAssistant = (input: {
    id: string
    threadId: string
    sequence: number
    modelId: string
    replacesMessageId?: string | null
  }): MessageDTO => {
    const stamp = now()
    return {
      id: input.id,
      projectId,
      threadId: input.threadId,
      sequence: input.sequence,
      role: "assistant",
      parts: [],
      status: "generating",
      modelId: input.modelId,
      replacesMessageId: input.replacesMessageId ?? null,
      supersededAt: null,
      feedback: null,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: null,
    }
  }

  const accepted = (
    thread: ThreadDTO,
    assistantMessage: MessageDTO,
    userMessage?: MessageDTO
  ): GenerationAcceptedDTO => ({
    project: clone(project!),
    thread: clone(thread),
    ...(userMessage ? { userMessage: clone(userMessage) } : {}),
    assistantMessage: clone(assistantMessage),
    streamUrl: `mock://thread-chat/${assistantMessage.id}`,
  })

  /** 在演示文档上提交一个新版本：写 revisions / artifacts / 目录项。 */
  const commitDemoRevision = (input: {
    changeSummary: string
    content: string
    sourceThreadId: string
    sourceMessageId: string
  }): DocumentRevisionDTO | null => {
    const document = documents.get(DEMO_DOCUMENT_ID)
    if (!document) return null
    const parent = revisions.get(document.currentRevisionId)
    if (!parent) return null
    const revision: DocumentRevisionDTO = {
      id: crypto.randomUUID(),
      documentId: DEMO_DOCUMENT_ID,
      revisionNumber: parent.revisionNumber + 1,
      parentRevisionId: parent.id,
      artifactId: crypto.randomUUID(),
      title: document.title,
      sourceThreadId: input.sourceThreadId,
      sourceMessageId: input.sourceMessageId,
      sourceMessageStatus: "completed",
      changeSummary: input.changeSummary,
      content: input.content,
      createdAt: now(),
    }
    revisions.set(revision.id, revision)
    artifacts.set(revision.artifactId, demoArtifactForRevision(projectId, revision))
    documents.set(document.id, {
      ...document,
      currentRevisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      currentArtifactId: revision.artifactId,
      sourceThreadId: input.sourceThreadId,
      sourceMessageId: input.sourceMessageId,
    })
    return revision
  }

  /** document-* 场景的完整 parts；构建即有副作用（并发版/新版本入库），
   * 结果缓存供流式 chunk 与终态共用。 */
  const documentTurnParts = (
    message: MessageDTO,
    scenario: Gate3HarnessScenario
  ): MessageDTO["parts"] => {
    const cached = documentPartsByMessageId.get(message.id)
    if (cached) return cached
    const parts = buildDocumentTurnParts(message, scenario)
    documentPartsByMessageId.set(message.id, parts)
    return parts
  }

  const buildDocumentTurnParts = (
    message: MessageDTO,
    scenario: Gate3HarnessScenario
  ): MessageDTO["parts"] => {
    const document = documents.get(DEMO_DOCUMENT_ID)
    if (!document)
      return [demoTextPart("演示文档不可用，已按普通回复完成。")]
    const current = revisions.get(document.currentRevisionId)
    if (!current)
      return [demoTextPart("演示文档版本缺失，已按普通回复完成。")]
    const call = (step: string) => `doc-${message.id}-${step}`
    const readId = () => crypto.randomUUID()
    const find = demoFindPart(projectId, call("find"), current.id)
    const read = demoReadPart(projectId, call("read"), current, {
      readId: readId(),
      isCurrent: true,
      currentRevisionId: current.id,
    })
    const edit = {
      oldText: "- [ ] 确定评分方案",
      newText: "- [ ] 确定评分方案\n- [ ] Harness 演示新增项",
    }
    const summary = "TODO 补充「Harness 演示新增项」"
    const concurrentCommit = () =>
      commitDemoRevision({
        changeSummary: "另一线程并发修改",
        content: `${current.content}\n- [ ] 并发写入项`,
        sourceThreadId: CHILD_THREAD_ID,
        sourceMessageId: DEMO_CONCURRENT_MESSAGE_ID,
      })
    const committedUpdate = (
      base: DocumentRevisionDTO,
      key: string
    ): MessageDTO["parts"][number] => {
      const committed = commitDemoRevision({
        changeSummary: summary,
        content: base.content.replace(edit.oldText, edit.newText),
        sourceThreadId: message.threadId,
        sourceMessageId: message.id,
      })
      if (!committed) {
        return demoUpdateErrorPart(
          call(key),
          demoUpdateInput(base.id, readId(), summary, edit),
          "DEMO_DOCUMENT_UNAVAILABLE"
        )
      }
      return demoUpdatePart(
        call(key),
        demoUpdateInput(base.id, readId(), summary, edit),
        {
          status: "committed",
          documentId: DEMO_DOCUMENT_ID,
          previousRevisionId: base.id,
          revisionId: committed.id,
          artifactId: committed.artifactId,
          changeSummary: summary,
        }
      )
    }
    const conflictResult = (currentRevisionId: string): UpdateDocumentResult => ({
      status: "conflict",
      code: "DOCUMENT_CHANGED",
      documentId: DEMO_DOCUMENT_ID,
      currentRevisionId,
      requiresRead: true,
    })

    switch (scenario) {
      case "document-commit":
        return [
          find,
          read,
          committedUpdate(current, "update"),
          demoTextPart("已按最新版本提交修改并保存。"),
        ]
      case "document-retry": {
        const concurrent = concurrentCommit()
        if (!concurrent)
          return [find, read, demoTextPart("演示文档不可用。")]
        const reread = demoReadPart(projectId, call("read-2"), concurrent, {
          readId: readId(),
          isCurrent: true,
          currentRevisionId: concurrent.id,
        })
        return [
          find,
          read,
          demoUpdatePart(
            call("update-1"),
            demoUpdateInput(current.id, readId(), summary, edit),
            conflictResult(concurrent.id)
          ),
          reread,
          committedUpdate(concurrent, "update-2"),
          demoTextPart("提交时检测到并发修改，已按最新版本重读并重新提交。"),
        ]
      }
      case "document-unchanged":
        return [
          find,
          read,
          demoUpdatePart(
            call("update"),
            demoUpdateInput(current.id, readId(), summary, {
              oldText: edit.oldText,
              newText: edit.oldText,
            }),
            {
              status: "unchanged",
              documentId: DEMO_DOCUMENT_ID,
              revisionId: current.id,
            }
          ),
          demoTextPart("目标内容已满足要求，无需重复保存。"),
        ]
      case "document-conflict": {
        const concurrent = concurrentCommit()
        if (!concurrent)
          return [find, read, demoTextPart("演示文档不可用。")]
        return [
          find,
          read,
          demoUpdatePart(
            call("update"),
            demoUpdateInput(current.id, readId(), summary, edit),
            conflictResult(concurrent.id)
          ),
          demoTextPart("提交时文档已被其他线程更新，本次未保存，请重试。"),
        ]
      }
      case "document-rejected":
        return [
          find,
          read,
          demoUpdatePart(
            call("update"),
            demoUpdateInput(current.id, readId(), "删除不存在的章节", {
              oldText: "## 9. 不存在的章节",
              newText: "",
            }),
            { status: "rejected", code: "SOURCE_NOT_FOUND" }
          ),
          demoTextPart("未在原文中找到目标内容，本次未保存。"),
        ]
      case "document-error":
        return [
          find,
          read,
          demoUpdateErrorPart(
            call("update"),
            demoUpdateInput(current.id, readId(), summary, edit),
            "DOCUMENT_STORE_TIMEOUT"
          ),
          demoTextPart("保存时发生错误，请稍后重试。"),
        ]
      default:
        return [demoTextPart(`已通过 ${scenario} 场景完成规范化 parts 收敛。`)]
    }
  }

  const finalMessage = (messageId: string): MessageDTO => {
    const current = messages.get(messageId)
    if (!current) throw new Error("MESSAGE_NOT_FOUND")
    if (current.status !== "generating") return clone(current)
    const scenario = scenarioByMessageId.get(messageId) ?? "normal"
    const stamp = now()
    let parts: MessageDTO["parts"] = [
      {
        type: "text",
        text: `已通过 ${scenario} 场景完成规范化 parts 收敛。`,
        state: "done",
      },
    ]
    let status: MessageDTO["status"] = "completed"
    let error: MessageDTO["error"] = null
    if (scenario === "failure") {
      status = "failed"
      error = { code: "HARNESS_FAILURE", message: "可控失败：请使用重新生成" }
      parts = [{ type: "text", text: "失败前保留的部分内容", state: "done" }]
    } else if (scenario === "artifact") {
      const artifactId = crypto.randomUUID()
      artifacts.set(artifactId, {
        id: artifactId,
        projectId,
        threadId: current.threadId,
        sourceMessageId: messageId,
        sourceThreadTitle:
          threads.get(current.threadId)?.customTitle ??
          threads.get(current.threadId)?.autoTitle ??
          null,
        sourceThreadFootnote: threads.get(current.threadId)?.footnote ?? null,
        sourceMessageStatus: "completed",
        kind: "markdown",
        title: "Gate 3 生成报告",
        content:
          "# Gate 3 生成报告\n\nArtifact 已通过 tool output ID 拉取并写入 Store。",
        language: null,
        metadata: {},
        createdAt: stamp,
        updatedAt: stamp,
      })
      parts = [
        {
          type: "tool-createMarkdownArtifact",
          toolCallId: `artifact-${messageId}`,
          state: "output-available",
          input: {
            title: "Gate 3 生成报告",
            content: "# Gate 3 生成报告",
          },
          output: { created: true, artifactId },
        },
      ]
    } else if (scenario === "research") {
      parts = [
        {
          type: "text",
          text: "研究流程已完成，并保留来源与结构化活动。",
          state: "done",
        },
        {
          type: "data-research-activity",
          id: `research-${messageId}`,
          data: {
            toolCallId: `search-${messageId}`,
            kind: "search",
            status: "complete",
            query: "AI SDK v7 UI Message",
            sources: [{ title: "AI SDK", url: "https://ai-sdk.dev/docs" }],
          },
        },
        {
          type: "source-url",
          sourceId: `source-${messageId}`,
          url: "https://ai-sdk.dev/docs",
          title: "AI SDK 文档",
        },
      ]
    } else if (DOCUMENT_SCENARIOS.has(scenario)) {
      parts = documentTurnParts(current, scenario)
    }
    const terminal: MessageDTO = {
      ...current,
      parts,
      status,
      error,
      updatedAt: stamp,
      finishedAt: stamp,
    }
    messages.set(messageId, terminal)
    return clone(terminal)
  }

  const client: ThreadChatClient = {
    async listThreadArtifacts(threadId: string) { return [...artifacts.values()].filter(artifact => artifact.threadId === threadId) },
    async listDocuments() { return { documents: [...documents.values()].map(clone), artifacts: [...artifacts.values()].map(clone) } },
    async getDocumentHistory(documentId: string) {
      return [...revisions.values()]
        .filter((revision) => revision.documentId === documentId)
        .map(clone)
    },
    async listProjects(archived = false) {
      return project && Boolean(project.archivedAt) === archived
        ? [
            {
              id: project.id,
              title:
                project.customTitle ??
                project.autoTitle ??
                PROJECT_TITLE_FALLBACK,
              updatedAt: project.updatedAt,
              threadCount: threads.size,
            },
          ]
        : []
    },
    async getProject() {
      return bootstrap()
    },
    async getMessage(messageId) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      if (
        seed.activeGenerationIds.includes(messageId) &&
        message.status === "generating"
      ) {
        const count = (backgroundPolls.get(messageId) ?? 0) + 1
        backgroundPolls.set(messageId, count)
        if (count >= 2) return finalMessage(messageId)
      }
      return clone(message)
    },
    async getArtifact(artifactId) {
      const artifact = artifacts.get(artifactId)
      if (!artifact) throw new Error("ARTIFACT_NOT_FOUND")
      return clone(artifact)
    },
    async startProject(_requestedProjectId, input) {
      if (!project) {
        const stamp = now()
        project = {
          id: input.projectId,
          rootThreadId: input.rootThreadId,
          autoTitle: null,
          customTitle: null,
          target: null,
          instructions: null,
          contractVersion: 0,
          archivedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        }
      }
      const thread = threads.get(project.rootThreadId)!
      const user = makeUser({
        id: input.userMessageId,
        threadId: thread.id,
        sequence: nextSequence(thread.id),
        parts: userParts(input),
      })
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: thread.id,
        sequence: user.sequence + 1,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(thread, assistant, user))
    },
    async sendMessage(threadId, input) {
      const thread = threads.get(threadId)
      if (!thread) throw new Error("THREAD_NOT_FOUND")
      const user = makeUser({
        id: input.userMessageId,
        threadId,
        sequence: nextSequence(threadId),
        parts: userParts(input),
      })
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId,
        sequence: user.sequence + 1,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(thread, assistant, user))
    },
    async generateThreadTitle(threadId) {
      const thread = threads.get(threadId)
      if (!thread || !project) throw new Error("THREAD_NOT_FOUND")
      const firstUser = [...messages.values()]
        .filter(
          (message) =>
            message.threadId === threadId &&
            message.role === "user" &&
            message.supersededAt === null
        )
        .sort((left, right) => left.sequence - right.sequence)[0]
      const firstUserText = firstUser ? textOf(firstUser) : ""
      const fallbackTitle =
        thread.parentId === null
          ? firstUserText.slice(0, 20)
          : (thread.anchorText ?? firstUserText).slice(0, 13)
      const title = fallbackTitle || null
      const updated = {
        ...thread,
        autoTitle: title,
        titleGenerationAttempted: true,
        titleGenerated: title !== null,
        updatedAt: now(),
      }
      threads.set(threadId, updated)
      if (thread.parentId === null)
        project = { ...project, autoTitle: title, updatedAt: updated.updatedAt }
      return {
        project: clone(project),
        thread: clone(updated),
        title,
        generated: title !== null,
      }
    },
    async forkThread(parentThreadId, input) {
      const parent = threads.get(parentThreadId)
      if (!parent) throw new Error("THREAD_NOT_FOUND")
      const anchor = input.target.anchor
      const anchorText = anchor.quote.exact
      const stamp = now()
      const thread: ThreadDTO = {
        id: input.threadId,
        projectId,
        parentId: parentThreadId,
        forkMessageId: input.sourceMessageId,
        forkContext: [],
        forkArtifactId: input.target.type === "artifact" ? input.target.artifactId : null,
        forkAnchor: anchor,
        anchorText,
        footnote:
          Math.max(
            0,
            ...[...threads.values()].map((row) => row.footnote ?? 0)
          ) + 1,
        depth: parent.depth + 1,
        modelId: input.modelId,
        autoTitle: anchorText.slice(0, 13),
        customTitle: null,
        titleGenerationAttempted: false,
        titleGenerated: false,
        createdAt: stamp,
        updatedAt: stamp,
      }
      threads.set(thread.id, thread)
      if (!input.firstTurn)
        return commandResponse({ thread: clone(thread), generation: null })
      const user = makeUser({
        id: input.firstTurn.userMessageId,
        threadId: thread.id,
        sequence: 1,
        parts: userParts(input.firstTurn),
      })
      const assistant = makeAssistant({
        id: input.firstTurn.assistantMessageId,
        threadId: thread.id,
        sequence: 2,
        modelId: input.modelId,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse({
        thread: clone(thread),
        generation: accepted(thread, assistant, user),
      })
    },
    async editMessage(userMessageId, input) {
      const source = messages.get(userMessageId)
      if (!source) throw new Error("MESSAGE_NOT_FOUND")
      const stamp = now()
      source.supersededAt = stamp
      source.updatedAt = stamp
      const oldAssistant = [...messages.values()]
        .filter(
          (message) =>
            message.threadId === source.threadId &&
            message.role === "assistant" &&
            message.sequence > source.sequence &&
            message.supersededAt === null
        )
        .sort((left, right) => left.sequence - right.sequence)[0]
      if (oldAssistant) {
        oldAssistant.supersededAt = stamp
        oldAssistant.updatedAt = stamp
      }
      const user = makeUser({
        id: input.userMessageId,
        threadId: source.threadId,
        sequence: nextSequence(source.threadId),
        parts: userParts(input),
      })
      user.replacesMessageId = source.id
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: source.threadId,
        sequence: user.sequence + 1,
        modelId: input.modelId,
        replacesMessageId: oldAssistant?.id ?? null,
      })
      messages.set(user.id, user)
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse({
        generation: accepted(threads.get(source.threadId)!, assistant, user),
        abortMessageId:
          oldAssistant?.status === "generating" ? oldAssistant.id : null,
      })
    },
    async retryMessage(messageId, input) {
      const source = messages.get(messageId)
      if (!source) throw new Error("MESSAGE_NOT_FOUND")
      const stamp = now()
      source.supersededAt = stamp
      source.updatedAt = stamp
      const assistant = makeAssistant({
        id: input.assistantMessageId,
        threadId: source.threadId,
        sequence: nextSequence(source.threadId),
        modelId: input.modelId,
        replacesMessageId: source.id,
      })
      messages.set(assistant.id, assistant)
      scenarioByMessageId.set(assistant.id, selectedScenario)
      return commandResponse(accepted(threads.get(source.threadId)!, assistant))
    },
    async stopMessage(messageId) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      if (message.status === "generating") {
        const stamp = now()
        messages.set(messageId, {
          ...message,
          status: "stopped",
          updatedAt: stamp,
          finishedAt: stamp,
        })
      }
      return commandResponse(clone(messages.get(messageId)!))
    },
    async setFeedback(messageId, input) {
      const message = messages.get(messageId)
      if (!message) throw new Error("MESSAGE_NOT_FOUND")
      const updated = { ...message, feedback: input.feedback, updatedAt: now() }
      messages.set(messageId, updated)
      return commandResponse(clone(updated))
    },
    async updateThread(threadId, input) {
      const thread = threads.get(threadId)
      if (!thread) throw new Error("THREAD_NOT_FOUND")
      const updated = {
        ...thread,
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.customTitle !== undefined
          ? { customTitle: input.customTitle }
          : {}),
        updatedAt: now(),
      }
      threads.set(threadId, updated)
      return commandResponse(clone(updated))
    },
    async renameProject(_targetProjectId, input) {
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      project = { ...project, customTitle: input.customTitle, updatedAt: now() }
      return commandResponse(clone(project))
    },
    async updateProjectContract(_targetProjectId, input) {
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      if (project.contractVersion !== input.expectedContractVersion)
        throw new Error("PROJECT_CONTRACT_VERSION_CONFLICT")
      project = {
        ...project,
        target: input.target.trim() || null,
        instructions: input.instructions.trim() || null,
        contractVersion: project.contractVersion + 1,
        updatedAt: now(),
      }
      return commandResponse(clone(project))
    },
    async addProjectFile() {
      throw new Error("PROJECT_FILE_UPLOAD_NOT_AVAILABLE_IN_GATE3_HARNESS")
    },
    async removeProjectFile(_targetProjectId, attachmentId) {
      return commandResponse({
        projectId,
        attachmentId,
        removed: true as const,
      })
    },
    async setProjectArchived(_targetProjectId, input) {
      if (!project) throw new Error("PROJECT_NOT_FOUND")
      project = {
        ...project,
        archivedAt: input.archived ? now() : null,
        updatedAt: now(),
      }
      return commandResponse(clone(project))
    },
    async deleteProject() {
      project = null
      threads.clear()
      messages.clear()
      artifacts.clear()
      documents.clear()
      revisions.clear()
      documentPartsByMessageId.clear()
      return commandResponse({ projectId, deleted: true as const })
    },
  }

  const fetchStream: typeof globalThis.fetch = async (input) => {
    const messageId = String(input).split("/").at(-1) ?? ""
    const scenario = scenarioByMessageId.get(messageId) ?? "normal"
    const encoder = new TextEncoder()
    let disconnected = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (disconnected) return
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        }
        const close = () => {
          if (disconnected) return
          disconnected = true
          controller.close()
        }
        const startDelay = scenario === "late-sse" ? 700 : 20
        setTimeout(() => {
          const current = messages.get(messageId)
          if (!current) return close()
          if (current.status !== "generating") {
            send({ type: "terminal", message: clone(current) })
            close()
            return
          }
          send({
            type: "snapshot",
            message: { id: messageId, role: "assistant", parts: [] },
            throughSeq: 0,
            replay: [],
          })
          if (DOCUMENT_SCENARIOS.has(scenario)) {
            /* 文档场景逐 chunk 发送：轨迹行能看到查找/读取/提交的进行中
             * spinner 与失败标红，终态与流式 parts 一致。 */
            const chunks = partsToStreamChunks(
              documentTurnParts(current, scenario)
            )
            let seq = 0
            const emitNext = () => {
              if (disconnected) return
              const chunk = chunks[seq]
              if (!chunk) {
                send({ type: "terminal", message: finalMessage(messageId) })
                close()
                return
              }
              seq += 1
              send({ type: "chunk", seq, chunk })
              setTimeout(emitNext, 260)
            }
            setTimeout(emitNext, 120)
            return
          }
          send({
            type: "chunk",
            seq: 1,
            chunk: { type: "text-start", id: "text" },
          })
          send({
            type: "chunk",
            seq: 2,
            chunk: {
              type: "text-delta",
              id: "text",
              delta: "正在验证规范化流…",
            },
          })
          if (scenario === "disconnect") {
            close()
            setTimeout(() => {
              if (messages.get(messageId)?.status === "generating")
                finalMessage(messageId)
            }, 180)
            return
          }
          setTimeout(() => {
            const currentMessage = messages.get(messageId)
            if (!currentMessage) return close()
            const terminal =
              currentMessage.status === "generating"
                ? finalMessage(messageId)
                : clone(currentMessage)
            send({
              type: "chunk",
              seq: 3,
              chunk: { type: "text-end", id: "text" },
            })
            send({ type: "terminal", message: terminal })
            close()
          }, 500)
        }, startDelay)
      },
      cancel() {
        disconnected = true
      },
    })
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  return {
    bootstrap: seed,
    client,
    fetchStream,
    setScenario(scenario: Gate3HarnessScenario) {
      selectedScenario = scenario
    },
    getScenario() {
      return selectedScenario
    },
    describeMessage(messageId: string) {
      const message = messages.get(messageId)
      return message ? `${message.status}: ${textOf(message)}` : "missing"
    },
  }
}

export const GATE3_HARNESS_IDS = {
  rootThreadId: ROOT_THREAD_ID,
  childThreadId: CHILD_THREAD_ID,
  nestedThreadId: NESTED_THREAD_ID,
} as const
