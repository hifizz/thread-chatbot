import { StrictMode, useState } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/thread-chat/new",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  usePathname: () => navigationMocks.pathname,
}))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
HTMLElement.prototype.scrollIntoView = vi.fn()

import {
  useAppShellCommands,
  useNewProjectDraftStore,
  useProject,
  useSubmitNewProjectDraft,
} from "@/lib/thread-chat/client/hooks"
import {
  NewProjectDraftProvider,
  ThreadChatAppProvider,
  ThreadChatProjectProvider,
  useThreadChatProjectRuntime,
} from "@/lib/thread-chat/client/providers"
import {
  assistantMessageDTOFixture,
  assistantRunDTOFixture,
  creationBundleDTOFixture,
  projectDTOFixture,
  rootThreadDTOFixture,
  userMessageDTOFixture,
} from "../fixtures/thread-chat-api-fixtures"
import { createTestApi } from "./test-api"
import { ThreadChatNew } from "@/app/thread-chat/normalized/thread-chat-new"

const bootstrap = {
  project: projectDTOFixture,
  threadTopology: [rootThreadDTOFixture],
  artifactSummary: { changeSequence: 0, total: 0, byKind: {} },
  initialThread: {
    threadId: rootThreadDTOFixture.id,
    messages: [userMessageDTOFixture, assistantMessageDTOFixture],
    assistantRuns: [assistantRunDTOFixture],
    hasOlderMessages: false,
    oldestReturnedSequence: 1,
    newestReturnedSequence: 2,
  },
}

beforeEach(() => {
  navigationMocks.replace.mockReset()
  navigationMocks.pathname = "/thread-chat/new"
})

describe("ThreadChat Providers and hooks", () => {
  it("/new 切换模型后更新选择器并把模型提交给创建命令", async () => {
    const createProject = vi.fn().mockResolvedValue(creationBundleDTOFixture)
    const user = userEvent.setup()

    render(
      <ThreadChatAppProvider
        api={createTestApi({ createProject })}
        navigation={{ replace: navigationMocks.replace }}
      >
        <NewProjectDraftProvider>
          <ThreadChatNew />
        </NewProjectDraftProvider>
      </ThreadChatAppProvider>
    )

    const selector = screen.getByRole("combobox", { name: "选择对话模型" })
    await user.click(selector)
    await user.click(
      screen.getByRole("option", { name: "UMAPIS · GPT-5.6 Sol" })
    )
    expect(selector.textContent).toContain("UMAPIS · GPT-5.6 Sol")

    await user.type(
      screen.getByPlaceholderText("继续在主线提问…"),
      "验证模型切换"
    )
    await user.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1))
    expect(createProject).toHaveBeenCalledWith({
      parts: [{ type: "text", text: "验证模型切换" }],
      requestedModelId: "umapis-gpt-5.6-sol",
    })
  })

  it("ProjectProvider 每个 projectId 复用唯一 Runtime，并由 Hook 细粒度读取", async () => {
    const bootstrapProject = vi.fn().mockResolvedValue(bootstrap)
    const user = userEvent.setup()
    let firstRuntime: unknown

    function Probe() {
      const project = useProject()
      const runtime = useThreadChatProjectRuntime()
      const shell = useAppShellCommands()
      const [renders, setRenders] = useState(0)
      firstRuntime ??= runtime
      return (
        <div>
          <span data-testid="project">{project?.id ?? "loading"}</span>
          <span data-testid="runtime">
            {runtime === firstRuntime ? "same" : "changed"}
          </span>
          <span data-testid="renders">{renders}</span>
          <button
            onClick={() => {
              shell.setSidebarOpen(false)
              setRenders((value) => value + 1)
            }}
          >
            toggle shell
          </button>
        </div>
      )
    }

    render(
      <StrictMode>
        <ThreadChatAppProvider
          api={createTestApi({ bootstrapProject })}
          navigation={{ replace: navigationMocks.replace }}
        >
          <ThreadChatProjectProvider projectId={projectDTOFixture.id}>
            <Probe />
          </ThreadChatProjectProvider>
        </ThreadChatAppProvider>
      </StrictMode>
    )
    await waitFor(() =>
      expect(screen.getByTestId("project").textContent).toBe(
        projectDTOFixture.id
      )
    )
    expect(screen.getByTestId("runtime").textContent).toBe("same")
    expect(bootstrapProject).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "toggle shell" }))
    expect(screen.getByTestId("renders").textContent).toBe("1")
    expect(bootstrapProject).toHaveBeenCalledTimes(1)
  })

  it("/new 先 seed Runtime、订阅生成，再根据服务端 projectId replace", async () => {
    const createProject = vi.fn().mockResolvedValue(creationBundleDTOFixture)
    const subscribeAssistantEvents = vi.fn(async function* () {
      yield {
        type: "run.failed" as const,
        eventSequence: 1,
        run: {
          ...assistantRunDTOFixture,
          status: "failed" as const,
          eventSequence: 1,
          error: { code: "fake_failed", message: "fake" },
          finishedAt: "2026-08-25T00:01:00.000Z",
        },
      }
    })
    const user = userEvent.setup()

    function DraftProbe() {
      const setDraftParts = useNewProjectDraftStore(
        (state) => state.setDraftParts
      )
      const status = useNewProjectDraftStore((state) => state.status)
      const submit = useSubmitNewProjectDraft()
      return (
        <>
          <span data-testid="status">{status}</span>
          <button
            onClick={() => {
              setDraftParts([{ type: "text", text: "hello" }])
              void submit()
            }}
          >
            submit draft
          </button>
        </>
      )
    }

    render(
      <ThreadChatAppProvider
        api={createTestApi({ createProject, subscribeAssistantEvents })}
        navigation={{ replace: navigationMocks.replace }}
      >
        <NewProjectDraftProvider>
          <DraftProbe />
        </NewProjectDraftProvider>
      </ThreadChatAppProvider>
    )
    await user.click(screen.getByRole("button", { name: "submit draft" }))
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1))
    expect(createProject).toHaveBeenCalledWith({
      parts: [{ type: "text", text: "hello" }],
      requestedModelId: undefined,
    })
    expect(JSON.stringify(createProject.mock.calls[0][0])).not.toContain("id")
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith(
        `/thread-chat/${projectDTOFixture.id}`
      )
    )
    expect(subscribeAssistantEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: assistantMessageDTOFixture.id,
        afterEventSequence: 0,
      })
    )
  })
})
