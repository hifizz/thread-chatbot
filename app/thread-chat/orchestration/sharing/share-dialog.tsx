"use client"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { SHARE_EXPIRIES, SHARE_EXPIRY_LABELS, SHARE_NOTICE } from "@/constants/sharing"
import type { CreateShareInput, ShareLayout, ShareSummary } from "@/lib/thread-chat/sharing/contracts"
import { shareCommandId } from "@/lib/thread-chat/sharing/browser-actions"

export type ShareTarget = { resourceType: "project" | "artifact"; resourceId: string }
export function ShareDialog({ target, captureLayout, onClose }: { target: ShareTarget; captureLayout(): ShareLayout; onClose(): void }) {
  const [expiry, setExpiry] = useState<CreateShareInput["expiry"]>("unlimited")
  const [shares, setShares] = useState<ShareSummary[]>([])
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [created, setCreated] = useState<ShareSummary | null>(null)
  const pending = useRef<CreateShareInput | null>(null)
  const inFlight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/thread-chat/v1/shares?${new URLSearchParams(target)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setShares(body.data)
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message || "无法读取分享列表") })
    return () => controller.abort()
  }, [target])
  async function create() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(""); setNotice("")
    try {
      // 失败重试沿用同一请求；成功后才允许创建新快照。
      pending.current ??= target.resourceType === "project"
        ? { ...target, resourceType: "project", commandId: shareCommandId(), expiry, layout: captureLayout() }
        : { ...target, resourceType: "artifact", commandId: shareCommandId(), expiry }
      const response = await fetch("/api/thread-chat/v1/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "分享创建失败")
      setCreated(body.data); setShares((current) => [body.data, ...current.filter((row) => row.id !== body.data.id)])
      pending.current = null; setRetrying(false)
    } catch (error) { setRetrying(!!pending.current); setError(error instanceof Error ? error.message : "分享创建失败") }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function revoke(id: string) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError("")
    try {
      const response = await fetch(`/api/thread-chat/v1/shares/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!response.ok) throw new Error("撤销失败，请重试")
      setShares((current) => current.map((row) => row.id === id ? { ...row, status: "revoked" } : row))
      if (created?.id === id) setCreated(null)
      setNotice("分享已撤销，后续访问将不可用。")
    } catch (error) { setError(error instanceof Error ? error.message : "撤销失败") }
    finally { inFlight.current = false; setBusy(false) }
  }
  const url = (path: string) => new URL(path, window.location.origin).href
  async function copy(path: string) {
    try { await navigator.clipboard.writeText(url(path)); setNotice("链接已复制") }
    catch { setError("复制失败，请选择链接后手动复制") }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="tc share-dialog">
      <DialogTitle>分享{target.resourceType === "project" ? " Project" : " Markdown"}</DialogTitle>
      <DialogDescription>{SHARE_NOTICE}</DialogDescription>
      <label>有效期 <select aria-label="分享有效期" disabled={busy || retrying} value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>{SHARE_EXPIRIES.map((value) => <option key={value} value={value}>{SHARE_EXPIRY_LABELS[value]}</option>)}</select></label>
      <button className="project-primary" disabled={busy} onClick={() => void create()}>{busy ? "处理中…" : retrying ? "重试创建" : "创建快照链接"}</button>
      {created && <label>新分享链接 <input aria-label="新分享链接" readOnly value={url(created.path)} onFocus={(e) => e.target.select()} /><button className="project-secondary" onClick={() => void copy(created.path)}>复制链接</button></label>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <section aria-label="已有分享"><h3>已有分享</h3>{shares.length === 0 && <p>暂无分享</p>}
        <ul>{shares.map((share) => <li key={share.id}><span>{new Date(share.createdAt).toLocaleString()} · {share.status === "revoked" ? "已撤销" : share.status === "expired" ? "已过期" : share.expiresAt ? `至 ${new Date(share.expiresAt).toLocaleString()}` : "无限期"}</span>
          {share.status === "active" && <><button className="project-secondary" disabled={busy} onClick={() => void copy(share.path)}>复制链接</button><button className="project-secondary" disabled={busy} onClick={() => void revoke(share.id)}>撤销</button></>}
        </li>)}</ul>
      </section>
    </DialogContent>
  </Dialog>
}
