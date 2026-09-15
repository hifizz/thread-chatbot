"use client";

// /agent-demo —— 类 Claude Code Web 的任务台：左侧任务列表 + 右侧执行时间线。
// 任务状态经 SSE 实时更新；PR 状态由 GitHub API 权威轮询（页面侧 10s）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type StoredEvent = {
  taskId: string;
  runId: string;
  seq: number;
  occurredAt: string;
  payload: { type: string; [key: string]: unknown };
};

type TaskResultView = {
  outcome: string;
  summary: string;
  changedFiles: string[];
  verification: { label: string; status: string; detail: string }[];
  commitSha: string | null;
  pullRequest: { url: string; number: number } | null;
};

type ViewBlock =
  | { kind: "phase"; id: string; label: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "completed" | "failed"; input: Json; output: Json | null; streamOutput: string }
  | { kind: "result"; id: string; result: TaskResultView }
  | { kind: "error"; id: string; message: string };

type Snapshot = {
  taskId: string;
  title: string;
  currentRunId: string;
  status: string;
  phase: string | null;
  lastSeq: number;
  repo: string;
  branch: string;
  environment: string;
  result: TaskResultView | null;
  error: { userMessage: string } | null;
  createdAt: string;
  updatedAt: string;
};

type TaskListItem = {
  taskId: string;
  title: string;
  repo: string;
  status: string;
  phase: string | null;
  createdAt: string;
  updatedAt: string;
  pullRequest: { url: string; number: number } | null;
};

type PullRequestState = {
  number: number;
  url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  headSha: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; status: string; conclusion: string | null }[];
  checksState: "none" | "pending" | "success" | "failure";
  updatedAt: string;
};

const DEFAULT_REPO = "hifizz/ai-daily";
const DEFAULT_GOAL =
  "阅读仓库的 README 和目录结构，在 docs/ 下新增一份架构说明文档 architecture.md，用中文描述这个项目的功能、目录结构和关键模块。";

const PHASE_ORDER = ["environment", "agent", "verify", "publish", "release"];
const PHASE_LABEL: Record<string, string> = {
  environment: "环境",
  agent: "执行",
  verify: "核实",
  publish: "发布",
  release: "回收",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  cancelling: "取消中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const isActive = (status: string) => status === "queued" || status === "running" || status === "cancelling";

function statusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "cancelled":
      return "bg-neutral-400";
    case "cancelling":
      return "bg-amber-500 animate-pulse";
    default:
      return "bg-blue-500 animate-pulse";
  }
}

function relativeTime(iso: string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtElapsed(ms: number) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
}

function prStateLabel(pr: PullRequestState) {
  if (pr.merged) return "已合并";
  if (pr.state === "closed") return "已关闭";
  if (pr.draft) return "Draft";
  return "Open";
}

export default function AgentDemoPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [blocks, setBlocks] = useState<ViewBlock[]>([]);
  const [pr, setPr] = useState<PullRequestState | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(0);
  const seenSeq = useRef(new Set<number>());
  const eventSource = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  // ── 事件 → 视图块 ───────────────────────────────────────────
  const applyEvent = useCallback((event: StoredEvent) => {
    if (seenSeq.current.has(event.seq)) return;
    seenSeq.current.add(event.seq);
    const p = event.payload;
    const rid = event.runId;

    setBlocks((prev) => {
      const next = [...prev];
      const toolIdx = (id: string) => next.findIndex((b) => b.kind === "tool" && b.id === id);
      const textIdx = (id: string) => next.findIndex((b) => b.kind === "text" && b.id === id);
      const thinkIdx = (id: string) => next.findIndex((b) => b.kind === "thinking" && b.id === id);

      switch (p.type) {
        case "phase.changed":
          next.push({ kind: "phase", id: `${rid}:phase:${p.phase as string}:${event.seq}`, label: String(p.label) });
          break;
        case "agent.text.delta": {
          const id = `${rid}:${p.blockId as string}`;
          const i = textIdx(id);
          if (i >= 0) next[i] = { ...next[i], text: (next[i] as { text: string }).text + (p.text as string) } as ViewBlock;
          else next.push({ kind: "text", id, text: String(p.text) });
          break;
        }
        case "agent.thinking.delta": {
          const id = `${rid}:${p.blockId as string}`;
          const i = thinkIdx(id);
          if (i >= 0) next[i] = { ...next[i], text: (next[i] as { text: string }).text + (p.text as string) } as ViewBlock;
          else next.push({ kind: "thinking", id, text: String(p.text) });
          break;
        }
        case "tool.started":
          next.push({
            kind: "tool",
            id: `${rid}:${p.toolCallId as string}`,
            name: String(p.name),
            status: "running",
            input: (p.input ?? null) as Json,
            output: null,
            streamOutput: "",
          });
          break;
        case "tool.output.updated": {
          const id = `${rid}:${p.toolCallId as string}`;
          const i = toolIdx(id);
          const chunk = typeof p.output === "string" ? p.output : JSON.stringify(p.output);
          if (i >= 0 && next[i].kind === "tool") {
            const b = next[i] as Extract<ViewBlock, { kind: "tool" }>;
            next[i] = { ...b, streamOutput: p.mode === "replace" ? chunk : b.streamOutput + chunk };
          }
          break;
        }
        case "tool.finished": {
          const id = `${rid}:${p.toolCallId as string}`;
          const i = toolIdx(id);
          const status = p.isError ? "failed" : "completed";
          if (i >= 0) next[i] = { ...next[i], status, output: (p.output ?? null) as Json } as ViewBlock;
          else next.push({ kind: "tool", id, name: "?", status, input: null, output: (p.output ?? null) as Json, streamOutput: "" });
          break;
        }
        case "run.result.saved":
          next.push({ kind: "result", id: `${rid}:result`, result: p.result as never });
          setSnapshot((s) => (s ? { ...s, result: p.result as TaskResultView } : s));
          break;
        case "run.error":
          next.push({ kind: "error", id: `${rid}:err:${event.seq}`, message: String((p.error as { userMessage?: string })?.userMessage ?? "未知错误") });
          break;
        case "run.status.changed":
          setSnapshot((s) => (s ? { ...s, status: String(p.status) } : s));
          break;
        default:
          break;
      }
      return next;
    });
  }, []);

  const subscribe = useCallback(
    (taskId: string, after: number) => {
      eventSource.current?.close();
      const es = new EventSource(`/api/agent-tasks/${taskId}/events?after=${after}`);
      eventSource.current = es;
      es.addEventListener("task-event", (e) => {
        applyEvent(JSON.parse((e as MessageEvent).data) as StoredEvent);
      });
      es.addEventListener("done", () => es.close());
    },
    [applyEvent]
  );

  // ── 选中任务：取快照 + 从 seq 0 补放事件，再挂 SSE ────────────
  const selectTask = useCallback(
    async (taskId: string | null) => {
      setSelectedId(taskId);
      setPr(null);
      setPrError(null);
      window.history.replaceState(null, "", taskId ? `?task=${taskId}` : window.location.pathname);
      if (!taskId) return;
      eventSource.current?.close();
      setBlocks([]);
      seenSeq.current = new Set();
      stickToBottom.current = true;
      const res = await fetch(`/api/agent-tasks/${taskId}`);
      if (!res.ok) {
        setSnapshot(null);
        setBlocks([{ kind: "error", id: "load", message: "任务不存在或已丢失（内存存储，dev 重启即清空）" }]);
        return;
      }
      const snap = (await res.json()) as Snapshot;
      setSnapshot(snap);
      subscribe(taskId, 0);
    },
    [subscribe]
  );

  const startTask = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/agent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, repo, idempotencyKey: crypto.randomUUID() }),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) {
        setBlocks([{ kind: "error", id: "start", message: data.error ?? "创建任务失败" }]);
        return;
      }
      await selectTask(data.taskId);
      refreshTasks();
    } finally {
      setStarting(false);
    }
  };

  const cancelTask = async () => {
    if (!selectedId) return;
    await fetch(`/api/agent-tasks/${selectedId}/cancel`, { method: "POST" });
    refreshTasks();
  };

  const refreshTasks = useCallback(async () => {
    const res = await fetch("/api/agent-tasks");
    if (res.ok) setTasks(((await res.json()) as { tasks: TaskListItem[] }).tasks);
  }, []);

  // 任务列表轮询；URL ?task= 恢复
  useEffect(() => {
    refreshTasks();
    const timer = setInterval(refreshTasks, 3000);
    const initial = new URLSearchParams(window.location.search).get("task");
    if (initial) setTimeout(() => void selectTask(initial), 0);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 运行中的任务状态轮询兜底（SSE 断线时仍能推进状态）
  useEffect(() => {
    if (!selectedId || !snapshot || !isActive(snapshot.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/agent-tasks/${selectedId}`);
      if (res.ok) {
        const snap = (await res.json()) as Snapshot;
        setSnapshot(snap);
        if (snap.lastSeq > Math.max(...seenSeq.current, 0)) {
          // 有漏事件则重订阅补齐
          subscribe(selectedId, Math.max(...seenSeq.current, 0));
        }
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [selectedId, snapshot?.status, subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  // PR 状态轮询：任务有 PR 后每 10s 从 GitHub 拉权威状态
  useEffect(() => {
    if (!selectedId || !snapshot?.result?.pullRequest) return;
    let stopped = false;
    const poll = async () => {
      const res = await fetch(`/api/agent-tasks/${selectedId}/pull-request`);
      if (stopped) return;
      if (res.ok) {
        const data = (await res.json()) as { pullRequest: PullRequestState | null };
        setPr(data.pullRequest);
        setPrError(null);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setPrError(data.error ?? "PR 状态暂不可用");
      }
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selectedId, snapshot?.result?.pullRequest]);

  // 秒表：运行中每秒刷新
  useEffect(() => {
    if (!snapshot || !isActive(snapshot.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [snapshot?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // 时间线自动吸底
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [blocks, snapshot?.status]);

  useEffect(() => () => eventSource.current?.close(), []);

  const elapsed = useMemo(() => {
    if (!snapshot) return null;
    const end = isActive(snapshot.status) ? now : new Date(snapshot.updatedAt).getTime();
    return fmtElapsed(Math.max(0, end - new Date(snapshot.createdAt).getTime()));
  }, [snapshot, now]);

  const phaseIdx = snapshot?.phase ? PHASE_ORDER.indexOf(snapshot.phase) : -1;
  const running = snapshot ? isActive(snapshot.status) : false;

  return (
    <div className="flex h-screen font-sans text-sm text-neutral-800 dark:text-neutral-200">
      {/* ── 左侧任务列表 ─────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Tasks</span>
          <button
            onClick={() => selectTask(null)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            + 新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 && (
            <p className="px-4 py-6 text-xs text-neutral-400">还没有任务</p>
          )}
          {tasks.map((t) => (
            <button
              key={t.taskId}
              onClick={() => selectTask(t.taskId)}
              className={`block w-full border-b border-neutral-100 px-4 py-3 text-left hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-900 ${
                selectedId === t.taskId ? "bg-neutral-100 dark:bg-neutral-900" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor(t.status)}`} />
                <span className="truncate font-medium">{t.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-4 text-xs text-neutral-400">
                <span className="truncate">{t.repo}</span>
                {t.pullRequest && <span className="shrink-0">PR #{t.pullRequest.number}</span>}
                <span className="ml-auto shrink-0">{relativeTime(t.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── 右侧主区 ─────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {!selectedId ? (
          /* 新建任务视图 */
          <div className="mx-auto w-full max-w-2xl px-6 py-12">
            <h1 className="text-xl font-semibold">新建 Agent 任务</h1>
            <p className="mt-1 mb-6 text-neutral-500">
              gpt-5.6-terra · e2b 沙箱 · GitHub Draft PR
            </p>
            <input
              className="mb-3 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-[13px] outline-none focus:border-neutral-500 dark:border-neutral-600"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name"
            />
            <textarea
              className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-600"
              rows={4}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="描述要完成的任务…"
            />
            <button
              onClick={startTask}
              disabled={starting || !goal.trim()}
              className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {starting ? "创建中…" : "启动任务"}
            </button>
            {blocks.some((b) => b.kind === "error") && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {blocks.find((b) => b.kind === "error")?.kind === "error" &&
                  (blocks.find((b) => b.kind === "error") as { message: string }).message}
              </div>
            )}
          </div>
        ) : (
          /* 任务详情视图 */
          <>
            <header className="border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${statusColor(snapshot?.status ?? "queued")}`} />
                <h1 className="min-w-0 flex-1 truncate font-semibold">
                  {snapshot?.title ?? selectedId}
                </h1>
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
                  {STATUS_LABEL[snapshot?.status ?? ""] ?? snapshot?.status ?? "加载中"}
                </span>
                {elapsed && <span className="font-mono text-xs text-neutral-400">{elapsed}</span>}
                {running && (
                  <button
                    onClick={cancelTask}
                    className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    停止
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{snapshot?.repo}</code>
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{snapshot?.branch}</code>
                <span>{snapshot?.environment}</span>
                {/* 阶段步进条 */}
                <div className="ml-auto flex items-center gap-1.5">
                  {PHASE_ORDER.map((ph, i) => (
                    <span key={ph} className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          i < phaseIdx || (!running && phaseIdx >= 0)
                            ? "bg-emerald-500"
                            : i === phaseIdx
                              ? running
                                ? "bg-blue-500 animate-pulse"
                                : "bg-emerald-500"
                              : "bg-neutral-300 dark:bg-neutral-700"
                        }`}
                      />
                      <span className={i === phaseIdx && running ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-400"}>
                        {PHASE_LABEL[ph]}
                      </span>
                      {i < PHASE_ORDER.length - 1 && <span className="text-neutral-300 dark:text-neutral-700">›</span>}
                    </span>
                  ))}
                </div>
              </div>
            </header>

            {/* 时间线 */}
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
              className="flex-1 overflow-y-auto px-5 py-4"
            >
              <div className="mx-auto max-w-3xl space-y-3">
                {blocks.map((block) => {
                  switch (block.kind) {
                    case "phase":
                      return (
                        <div key={block.id} className="flex items-center gap-2 pt-2 text-xs tracking-wide text-neutral-400 uppercase">
                          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                          {block.label}
                          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                        </div>
                      );
                    case "text":
                      return (
                        <div key={block.id} className="rounded-lg border border-neutral-200 p-4 leading-relaxed break-words whitespace-pre-wrap dark:border-neutral-800">
                          {block.text}
                        </div>
                      );
                    case "thinking":
                      return (
                        <details key={block.id} className="rounded-lg border border-dashed border-neutral-300 p-3 text-neutral-500 dark:border-neutral-700">
                          <summary className="cursor-pointer text-xs">思考过程（{block.text.length} 字）</summary>
                          <div className="mt-2 font-mono text-xs break-words whitespace-pre-wrap">{block.text}</div>
                        </details>
                      );
                    case "tool":
                      return (
                        <div key={block.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
                          <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
                            <span
                              className={
                                block.status === "running"
                                  ? "inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"
                                  : block.status === "completed"
                                    ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
                                    : "inline-block h-2 w-2 rounded-full bg-red-500"
                              }
                            />
                            <code className="text-xs font-semibold">{block.name}</code>
                            <span className="text-xs text-neutral-400">
                              {block.status === "running" ? "执行中" : block.status === "completed" ? "完成" : "失败"}
                            </span>
                          </div>
                          <details className="px-3 py-2" open={block.status !== "completed"}>
                            <summary className="cursor-pointer text-xs text-neutral-400">参数与输出</summary>
                            <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-xs dark:bg-neutral-900">
                              {JSON.stringify(block.input, null, 2)}
                            </pre>
                            {block.streamOutput && (
                              <pre className="mt-2 overflow-x-auto rounded bg-neutral-950 p-2 font-mono text-xs text-emerald-300 whitespace-pre-wrap">
                                {block.streamOutput}
                                {block.status === "running" && <span className="animate-pulse">▌</span>}
                              </pre>
                            )}
                            {block.output !== null && (
                              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-xs dark:bg-neutral-900">
                                {typeof block.output === "string" ? block.output : JSON.stringify(block.output, null, 2)}
                              </pre>
                            )}
                          </details>
                        </div>
                      );
                    case "result":
                      return (
                        <div key={block.id} className="rounded-lg border-2 border-emerald-500/40 p-4">
                          <div className="mb-2 text-xs font-semibold tracking-wide text-emerald-600 uppercase">
                            执行结果 · {block.result.outcome}
                          </div>
                          <div className="mb-3 break-words whitespace-pre-wrap">{block.result.summary}</div>
                          {block.result.changedFiles.length > 0 && (
                            <div className="mb-2 text-xs">
                              变更文件：
                              {block.result.changedFiles.map((f) => (
                                <code key={f} className="mr-2 rounded bg-neutral-100 px-1 dark:bg-neutral-800">{f}</code>
                              ))}
                            </div>
                          )}
                          {block.result.commitSha && (
                            <div className="mb-2 text-xs">
                              commit：<code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{block.result.commitSha.slice(0, 8)}</code>
                            </div>
                          )}
                          <ul className="space-y-1 text-xs">
                            {block.result.verification.map((v, i) => (
                              <li key={i}>
                                {v.status === "passed" ? "✓" : v.status === "failed" ? "✗" : "–"} {v.label}
                                <span className="text-neutral-400">（{v.detail}）</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    case "error":
                      return (
                        <div key={block.id} className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                          {block.message}
                        </div>
                      );
                  }
                })}
              </div>
            </div>

            {/* PR 状态卡：GitHub 权威数据，10s 轮询 */}
            {snapshot?.result?.pullRequest && (
              <footer className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
                <div className="mx-auto flex max-w-3xl items-center gap-3">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      !pr
                        ? "bg-neutral-300"
                        : pr.merged
                          ? "bg-purple-500"
                          : pr.state === "closed"
                            ? "bg-red-500"
                            : pr.draft
                              ? "bg-neutral-400"
                              : "bg-emerald-500"
                    }`}
                  />
                  <a
                    href={snapshot.result.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-600 underline dark:text-blue-400"
                  >
                    PR #{snapshot.result.pullRequest.number}
                  </a>
                  {pr ? (
                    <>
                      <span className="text-xs">{prStateLabel(pr)}</span>
                      <span className="text-xs text-neutral-400">
                        {pr.headSha.slice(0, 7)} → {pr.baseBranch}
                      </span>
                      <span className="text-xs">
                        <span className="text-emerald-600">+{pr.additions}</span>{" "}
                        <span className="text-red-500">−{pr.deletions}</span>{" "}
                        <span className="text-neutral-400">({pr.changedFiles} 文件)</span>
                      </span>
                      {pr.checksState !== "none" && (
                        <span className="text-xs text-neutral-400">
                          checks:
                          {pr.checksState === "pending" && <span className="text-amber-500"> 进行中</span>}
                          {pr.checksState === "success" && <span className="text-emerald-600"> 通过</span>}
                          {pr.checksState === "failure" && <span className="text-red-500"> 失败</span>}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-neutral-400">{relativeTime(pr.updatedAt)} 前更新</span>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-400">{prError ?? "查询 PR 状态中…"}</span>
                  )}
                </div>
              </footer>
            )}
          </>
        )}
      </main>
    </div>
  );
}
