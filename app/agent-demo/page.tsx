"use client";

// /agent-demo —— 方案 P1 的最小网页：输入目标 → 创建任务 → SSE 展示完整执行过程。
// 视图块 id 由 runId + messageId/blockId/toolCallId 构成，按 seq 去重。

import { useCallback, useEffect, useRef, useState } from "react";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type StoredEvent = {
  taskId: string;
  runId: string;
  seq: number;
  occurredAt: string;
  payload: {
    type: string;
    [key: string]: unknown;
  };
};

type ViewBlock =
  | { kind: "phase"; id: string; label: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "completed" | "failed"; input: Json; output: Json | null; streamOutput: string }
  | { kind: "result"; id: string; result: { outcome: string; summary: string; changedFiles: string[]; verification: { label: string; status: string; detail: string }[]; commitSha: string | null; pullRequest: { url: string; number: number } | null } }
  | { kind: "error"; id: string; message: string };

type Snapshot = {
  taskId: string;
  currentRunId: string;
  status: string;
  phase: string | null;
  lastSeq: number;
  repo: string;
  branch: string;
  environment: string;
  workspacePath: string;
  result: { summary: string; changedFiles: string[] } | null;
  error: { userMessage: string } | null;
};

const DEFAULT_REPO = "hifizz/ai-daily";
const DEFAULT_GOAL =
  "阅读仓库的 README 和目录结构，在 docs/ 下新增一份架构说明文档 architecture.md，用中文描述这个项目的功能、目录结构和关键模块。";

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function AgentDemoPage() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [blocks, setBlocks] = useState<ViewBlock[]>([]);
  const [starting, setStarting] = useState(false);
  const seenSeq = useRef(new Set<number>());
  const eventSource = useRef<EventSource | null>(null);

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
            next[i] = {
              ...b,
              streamOutput: p.mode === "replace" ? chunk : b.streamOutput + chunk,
            };
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
      es.onerror = () => {
        // EventSource 自动重连；终态时服务端会发 done 主动关闭
      };
    },
    [applyEvent]
  );

  const startTask = async () => {
    setStarting(true);
    setBlocks([]);
    setSnapshot(null);
    seenSeq.current = new Set();
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
      const snap = (await (await fetch(`/api/agent-tasks/${data.taskId}`)).json()) as Snapshot;
      setSnapshot(snap);
      subscribe(data.taskId, snap.lastSeq);
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => () => eventSource.current?.close(), []);

  const running = snapshot?.status === "running" || snapshot?.status === "queued";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 font-sans text-sm text-neutral-800 dark:text-neutral-200">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Agent Task Demo</h1>
        <p className="mt-1 text-neutral-500">
          模型：{process.env.NEXT_PUBLIC_AGENT_MODEL ?? "gpt-5.6-terra"}（AGENT_MODEL_*）· e2b 沙箱 + GitHub · 内存事件表 + SSE
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
        <input
          className="mb-3 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-[13px] outline-none focus:border-neutral-500 dark:border-neutral-600"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/name"
          disabled={running === true}
        />
        <textarea
          className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-600"
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={running === true}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={startTask}
            disabled={starting || running === true || !goal.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {starting ? "创建中…" : running ? "任务执行中…" : "启动任务"}
          </button>
          {snapshot && (
            <span className="text-neutral-500">
              {snapshot.taskId} · {snapshot.environment} · {snapshot.branch} · 状态：
              <b className="text-neutral-800 dark:text-neutral-200">{STATUS_LABEL[snapshot.status] ?? snapshot.status}</b>
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {blocks.map((block) => {
          switch (block.kind) {
            case "phase":
              return (
                <div key={block.id} className="flex items-center gap-2 pt-2 text-xs tracking-wide text-neutral-400 uppercase">
                  <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                  {block.label}
                  <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                </div>
              );
            case "text":
              return (
                <div key={block.id} className="rounded-lg border border-neutral-200 p-4 leading-relaxed break-words whitespace-pre-wrap dark:border-neutral-700">
                  {block.text}
                </div>
              );
            case "thinking":
              return (
                <details key={block.id} className="rounded-lg border border-dashed border-neutral-300 p-3 text-neutral-500 dark:border-neutral-600">
                  <summary className="cursor-pointer text-xs">思考过程（{block.text.length} 字）</summary>
                  <div className="mt-2 font-mono text-xs break-words whitespace-pre-wrap">{block.text}</div>
                </details>
              );
            case "tool":
              return (
                <div key={block.id} className="rounded-lg border border-neutral-200 dark:border-neutral-700">
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
                  {block.result.pullRequest && (
                    <div className="mb-2 text-xs">
                      Draft PR：
                      <a
                        className="text-blue-600 underline dark:text-blue-400"
                        href={block.result.pullRequest.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{block.result.pullRequest.number} {block.result.pullRequest.url}
                      </a>
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

      {snapshot && (
        <footer className="mt-8 text-xs text-neutral-400">
          仓库：{snapshot.repo} · 工作区：{snapshot.workspacePath || `${snapshot.environment} 沙箱内检出`}
        </footer>
      )}
    </div>
  );
}
