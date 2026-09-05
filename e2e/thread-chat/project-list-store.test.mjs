import assert from "node:assert/strict"
import test from "node:test"

import { createProjectListStore } from "../../app/thread-chat/core/project-list-store.tsx"

const item = (title) => ({
  id: "project-1",
  title,
  updatedAt: "2026-09-04T00:00:00.000Z",
  threadCount: 2,
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

await test("project list store coalesces requests and ignores stale refreshes", async () => {
  const requests = []
  const store = createProjectListStore({
    listProjects() {
      const request = deferred()
      requests.push(request)
      return request.promise
    },
  })

  const first = store.getState().refresh()
  const duplicate = store.getState().refresh()
  assert.equal(first, duplicate)
  assert.equal(requests.length, 1)

  requests[0].resolve([item("旧标题")])
  await first
  assert.equal(store.getState().items[0].title, "旧标题")

  const staleRefresh = store.getState().refresh()
  store.getState().setTitle("project-1", "新标题")
  requests[1].resolve([item("旧标题")])
  await staleRefresh

  assert.equal(store.getState().items[0].title, "新标题")
  assert.equal(store.getState().refreshing, false)
})
