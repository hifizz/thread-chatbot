"use client"

import { useEffect, useRef, useState } from "react"
import type { ThreadRepositoryBinding } from "@/lib/thread-chat/contracts/dto"

interface RepoItem {
  fullName: string
  defaultBranch: string
  private: boolean
  description: string | null
  updatedAt: string
}

interface BranchItem {
  name: string
}

export interface RepoBindingPickerProps {
  binding: ThreadRepositoryBinding | null
  onChange: (binding: ThreadRepositoryBinding | null) => void
  disabled?: boolean
}

export function RepoBindingPicker({
  binding,
  onChange,
  disabled,
}: RepoBindingPickerProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"select-repo" | "select-branch">(
    "select-repo"
  )
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [branches, setBranches] = useState<BranchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<RepoItem | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  async function loadRepos() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/agent-repos")
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "加载失败")
      }
      const data = (await res.json()) as { repos: RepoItem[] }
      setRepos(data.repos)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载仓库列表失败")
    } finally {
      setLoading(false)
    }
  }

  async function loadBranches(repo: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/agent-repos/branches?repo=${encodeURIComponent(repo)}`
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "加载失败")
      }
      const data = (await res.json()) as { branches: string[]; defaultBranch: string }
      setBranches(data.branches.map((name) => ({ name })))
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载分支列表失败")
    } finally {
      setLoading(false)
    }
  }

  function openPicker() {
    if (disabled) return
    setOpen(true)
    setMode("select-repo")
    setError(null)
    setSearch("")
    setSelectedRepo(null)
    void loadRepos()
  }

  function pickRepo(repo: RepoItem) {
    setSelectedRepo(repo)
    setMode("select-branch")
    void loadBranches(repo.fullName)
  }

  function pickBranch(branch: string) {
    if (!selectedRepo) return
    onChange({
      connectionId: "github",
      repositoryFullName: selectedRepo.fullName,
      branch,
    })
    setOpen(false)
  }

  function remove() {
    onChange(null)
  }

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  )

  if (!binding) {
    return (
      <div className="repo-binding-picker">
        <button
          type="button"
          className="repo-binding-add"
          onClick={openPicker}
          disabled={disabled}
        >
          + 选择 GitHub 仓库
        </button>
        {open && (
          <div className="repo-binding-popover" ref={popoverRef}>
            {loading && <div className="repo-binding-loading">加载中…</div>}
            {error && <div className="repo-binding-error">{error}</div>}
            {mode === "select-repo" && !loading && (
              <>
                <input
                  className="repo-binding-search"
                  placeholder="搜索仓库…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <div className="repo-binding-list">
                  {filtered.map((repo) => (
                    <button
                      key={repo.fullName}
                      className="repo-binding-item"
                      onClick={() => pickRepo(repo)}
                    >
                      <span className="repo-binding-name">
                        {repo.fullName}
                        {repo.private && (
                          <span className="repo-binding-private">私有</span>
                        )}
                      </span>
                      <span className="repo-binding-default">
                        {repo.defaultBranch}
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className="repo-binding-empty">没有匹配的仓库</div>
                  )}
                </div>
              </>
            )}
            {mode === "select-branch" && !loading && (
              <div className="repo-binding-list">
                <div className="repo-binding-back">
                  <button onClick={() => setMode("select-repo")}>← 返回</button>
                  <span>{selectedRepo?.fullName}</span>
                </div>
                {branches.map((b) => (
                  <button
                    key={b.name}
                    className="repo-binding-item"
                    onClick={() => pickBranch(b.name)}
                  >
                    <span className="repo-binding-name">{b.name}</span>
                  </button>
                ))}
                {branches.length === 0 && (
                  <div className="repo-binding-empty">没有分支</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="repo-binding-picker">
      <span className="repo-binding-chip">
        <span className="repo-binding-icon">📁</span>
        <span className="repo-binding-label">
          {binding.repositoryFullName} · {binding.branch}
        </span>
        <button
          type="button"
          className="repo-binding-action"
          onClick={openPicker}
          disabled={disabled}
        >
          切换
        </button>
        <button
          type="button"
          className="repo-binding-action"
          onClick={remove}
          disabled={disabled}
        >
          移除
        </button>
      </span>
      {open && (
        <div className="repo-binding-popover" ref={popoverRef}>
          {loading && <div className="repo-binding-loading">加载中…</div>}
          {error && <div className="repo-binding-error">{error}</div>}
          {mode === "select-repo" && !loading && (
            <>
              <input
                className="repo-binding-search"
                placeholder="搜索仓库…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              <div className="repo-binding-list">
                {filtered.map((repo) => (
                  <button
                    key={repo.fullName}
                    className="repo-binding-item"
                    onClick={() => pickRepo(repo)}
                  >
                    <span className="repo-binding-name">
                      {repo.fullName}
                      {repo.private && (
                        <span className="repo-binding-private">私有</span>
                      )}
                    </span>
                    <span className="repo-binding-default">
                      {repo.defaultBranch}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {mode === "select-branch" && !loading && (
            <div className="repo-binding-list">
              <div className="repo-binding-back">
                <button onClick={() => setMode("select-repo")}>← 返回</button>
                <span>{selectedRepo?.fullName}</span>
              </div>
              {branches.map((b) => (
                <button
                  key={b.name}
                  className="repo-binding-item"
                  onClick={() => pickBranch(b.name)}
                >
                  <span className="repo-binding-name">{b.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
