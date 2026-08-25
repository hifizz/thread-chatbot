import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import { ThreadChatDomainError } from "@/lib/thread-chat/domain/domain-error"
import {
  errorResponse,
  ThreadChatApiError,
} from "@/lib/thread-chat/api/server/errors"

async function readError(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
  }
}

describe("ThreadChat API error mapping", () => {
  it.each([
    ["project_owner_mismatch", "forbidden", 403],
    ["thread_archived", "thread_archived", 409],
    ["thread_generation_in_progress", "thread_generation_in_progress", 409],
    [
      "root_thread_title_owned_by_project",
      "root_thread_title_owned_by_project",
      422,
    ],
    [
      "root_thread_archive_owned_by_project",
      "root_thread_archive_owned_by_project",
      422,
    ],
    ["message_not_editable", "message_not_editable", 422],
    ["message_not_regeneratable", "message_not_regeneratable", 422],
    ["feedback_not_eligible", "message_not_feedback_eligible", 422],
    ["fork_required", "fork_required", 422],
    ["fork_anchor_mismatch", "fork_anchor_mismatch", 422],
    ["message_not_fork_eligible", "fork_source_not_finalized", 422],
    ["message_not_finalized", "fork_source_not_finalized", 422],
    ["message_superseded", "fork_source_superseded", 422],
    ["thread_source_invalid", "fork_source_thread_mismatch", 422],
    ["thread_not_found", "thread_not_found", 404],
    ["message_not_found", "message_not_found", 404],
    ["source_message_not_found", "source_message_not_found", 404],
    ["assistant_message_not_found", "assistant_message_not_found", 404],
    ["message_run_not_found", "message_run_not_found", 404],
  ] as const)("映射 %s", async (domainCode, apiCode, status) => {
    expect(
      await readError(
        errorResponse(new ThreadChatDomainError(domainCode, "mapped"))
      )
    ).toEqual({
      status,
      body: { error: { code: apiCode, message: "mapped" } },
    })
  })

  it("按 Route fallback 映射 entity_not_found", async () => {
    expect(
      await readError(
        errorResponse(
          new ThreadChatDomainError("entity_not_found", "missing"),
          "artifact_not_found"
        )
      )
    ).toEqual({
      status: 404,
      body: { error: { code: "artifact_not_found", message: "missing" } },
    })
  })

  it("保留显式 API 错误与 Zod details，隐藏未知异常", async () => {
    expect(
      await readError(
        errorResponse(
          new ThreadChatApiError("project_delete_conflict", 409, "busy", {
            projectId: "project",
          })
        )
      )
    ).toEqual({
      status: 409,
      body: {
        error: {
          code: "project_delete_conflict",
          message: "busy",
          details: { projectId: "project" },
        },
      },
    })

    const zodError = new ZodError([
      {
        code: "custom",
        path: ["field"],
        message: "invalid",
      },
    ])
    const validation = await readError(errorResponse(zodError))
    expect(validation.status).toBe(400)
    expect(validation.body.error).toMatchObject({ code: "validation_error" })

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(
      await readError(errorResponse(new Error("database secret")))
    ).toEqual({
      status: 500,
      body: {
        error: {
          code: "internal_error",
          message: "Internal server error.",
        },
      },
    })
    consoleError.mockRestore()
  })
})
