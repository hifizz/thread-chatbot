/** 只替换附件 HTTP；输入事件、React 状态与上传队列均使用正式实现。 */
export function installComposerUploadStub() {
  const originalFetch = window.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const uploads = new WeakSet()
  const state = { created: [], deleted: [], pending: [], hold: false, failNext: false }
  window.__composerUploads = state
  window.fetch = async (url, init) => {
    if (url === "/api/attachments" && init?.method === "POST") {
      const id = crypto.randomUUID()
      state.created.push({ id, ...JSON.parse(init.body) })
      return Response.json({ id, uploadUrl: `${location.origin}/__composer-test-upload/${id}` })
    }
    if (typeof url === "string" && url.startsWith("/api/attachments/")) {
      if (init?.method === "DELETE") {
        state.deleted.push(url.split("/").at(-1))
        return Response.json({})
      }
      if (url.endsWith("/ingest")) {
        if (state.hold) await new Promise((resolve) => state.pending.push(resolve))
        const fail = state.failNext
        state.failNext = false
        return Response.json(fail ? { error: "测试上传失败" } : {}, { status: fail ? 500 : 200 })
      }
    }
    return originalFetch(url, init)
  }
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    if (String(url).includes("/__composer-test-upload/")) { uploads.add(this); return }
    return originalOpen.call(this, method, url, ...args)
  }
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function (...args) {
    if (!uploads.has(this)) return originalSetHeader.apply(this, args)
  }
  XMLHttpRequest.prototype.send = function (body) {
    if (!uploads.has(this)) return originalSend.call(this, body)
    queueMicrotask(() => {
      Object.defineProperty(this, "status", { value: 200, configurable: true })
      this.upload.dispatchEvent(new ProgressEvent("progress", { loaded: body.size, total: body.size, lengthComputable: true }))
      this.dispatchEvent(new ProgressEvent("load"))
    })
  }
}
