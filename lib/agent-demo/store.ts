// 内存版 Task/Run/Event 存储，模拟方案 §5 的 tasks / task_runs / task_events：
// (task_id, seq) 单调递增去重，快照与事件在同一处更新。
// 所有事件写入前统一脱敏（方案 §12：服务端事件不得存秘密）。

import type {
  RunStatus,
  StoredEvent,
  TaskError,
  TaskEvent,
  TaskResult,
  TaskSnapshot,
  TaskStatus,
} from "@/lib/agent-demo/contracts";

type TaskRecord = {
  id: string;
  goal: string;
  title: string;
  repo: string;
  branch: string;
  environment: string;
  status: TaskStatus;
  currentRunId: string;
  phase: string | null;
  nextEventSeq: number;
  workspacePath: string;
  result: TaskResult | null;
  error: TaskError | null;
  events: StoredEvent[];
  seenSourceIds: Set<string>;
  createdAt: string;
  updatedAt: string;
  /** 执行代次控制：取消请求与中止控制器。 */
  cancelRequested: boolean;
  abortController: AbortController | null;
  releaseEnv: (() => Promise<void>) | null;
};

type Store = {
  tasks: Map<string, TaskRecord>;
  sourceCounter: number;
};

const globalStore = globalThis as unknown as { __agentDemoStore?: Store };

function store(): Store {
  return (globalStore.__agentDemoStore ??= {
    tasks: new Map(),
    sourceCounter: 0,
  });
}

/** 事件落库前的统一脱敏：任何秘密都不允许进入事件表或前端。 */
function sanitizeSecrets(payload: TaskEvent): TaskEvent {
  const secrets = [
    process.env.GITHUB_TOKEN,
    process.env.BOXD_API_KEY,
    process.env.E2B_API_KEY,
    process.env.AGENT_MODEL_API_KEY,
  ].filter((s): s is string => Boolean(s && s.length > 8));
  if (secrets.length === 0) return payload;
  let text = JSON.stringify(payload);
  for (const secret of secrets) text = text.split(secret).join("***");
  return JSON.parse(text) as TaskEvent;
}

export function createTask(input: {
  goal: string;
  title: string;
  repo: string;
  branch: string;
  environment: string;
  workspacePath: string;
}) {
  const task: TaskRecord = {
    id: `task-${crypto.randomUUID().slice(0, 8)}`,
    goal: input.goal,
    title: input.title,
    repo: input.repo,
    branch: input.branch,
    environment: input.environment,
    status: "queued",
    currentRunId: `run-${crypto.randomUUID().slice(0, 8)}`,
    phase: null,
    nextEventSeq: 1,
    workspacePath: input.workspacePath,
    result: null,
    error: null,
    events: [],
    seenSourceIds: new Set(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelRequested: false,
    abortController: null,
    releaseEnv: null,
  };
  store().tasks.set(task.id, task);
  emit(task.id, "task", { type: "task.created", title: input.title });
  return task;
}

export function getTask(taskId: string) {
  return store().tasks.get(taskId) ?? null;
}

export function getSnapshot(taskId: string): TaskSnapshot | null {
  const task = getTask(taskId);
  if (!task) return null;
  return {
    taskId: task.id,
    title: task.title,
    currentRunId: task.currentRunId,
    status: task.status,
    phase: task.phase,
    lastSeq: task.nextEventSeq - 1,
    repo: task.repo,
    branch: task.branch,
    environment: task.environment,
    workspacePath: task.workspacePath,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt ?? task.createdAt,
  };
}

export function getEventsAfter(taskId: string, after: number): StoredEvent[] {
  const task = getTask(taskId);
  if (!task) return [];
  return task.events.filter((event) => event.seq > after);
}

/** 追加事件并维护派生状态；带稳定标识的事件按标识去重。返回是否真正写入。 */
export function emit(taskId: string, source: string, payload: TaskEvent): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  const sourceEventId = `${source}:${store().sourceCounter++}`;
  const dedupeKey =
    // 只去重幂等性事件；delta/output.updated 是增量语义，必须全部保留
    payload.type === "tool.started" || payload.type === "tool.finished"
      ? `${payload.type}:${payload.toolCallId}`
      : payload.type === "agent.message.started"
        ? `${payload.type}:${payload.messageId}`
        : sourceEventId;
  if (task.seenSourceIds.has(dedupeKey)) return false;
  task.seenSourceIds.add(dedupeKey);

  const event: StoredEvent = {
    schemaVersion: 1,
    taskId: task.id,
    runId: task.currentRunId,
    seq: task.nextEventSeq++,
    sourceEventId,
    occurredAt: new Date().toISOString(),
    payload: sanitizeSecrets(payload),
  };
  task.events.push(event);
  task.updatedAt = event.occurredAt;

  if (payload.type === "run.status.changed") {
    task.status = payload.status as TaskStatus;
  }
  if (payload.type === "phase.changed") {
    task.phase = payload.phase;
  }
  if (payload.type === "run.result.saved") {
    task.result = payload.result;
  }
  if (payload.type === "run.error") {
    task.error = payload.error;
  }
  return true;
}

export function setRunStatus(taskId: string, status: RunStatus) {
  emit(taskId, "task", { type: "run.status.changed", status });
}

export type TaskListItem = {
  taskId: string;
  title: string;
  repo: string;
  branch: string;
  environment: string;
  status: TaskStatus;
  phase: string | null;
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
  pullRequest: { url: string; number: number } | null;
};

export function listTasks(): TaskListItem[] {
  return [...store().tasks.values()]
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      repo: task.repo,
      branch: task.branch,
      environment: task.environment,
      status: task.status,
      phase: task.phase,
      lastSeq: task.nextEventSeq - 1,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt ?? task.createdAt,
      pullRequest: task.result?.pullRequest
        ? { url: task.result.pullRequest.url, number: task.result.pullRequest.number }
        : null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 为当前 Run 注册中止控制器与环境释放钩子。 */
export function registerRunHandles(
  taskId: string,
  handles: { abortController?: AbortController; releaseEnv?: () => Promise<void> }
) {
  const task = getTask(taskId);
  if (!task) return;
  if (handles.abortController) task.abortController = handles.abortController;
  if (handles.releaseEnv) task.releaseEnv = handles.releaseEnv;
}

export function isCancelRequested(taskId: string): boolean {
  return getTask(taskId)?.cancelRequested === true;
}

/**
 * 请求取消：置标记、进入 cancelling、中止模型流并回收远端环境。
 * 返回是否受理（仅运行中可取消）。
 */
export async function requestCancel(taskId: string): Promise<boolean> {
  const task = getTask(taskId);
  if (!task || task.status !== "running") return false;
  task.cancelRequested = true;
  setRunStatus(taskId, "cancelling");
  task.abortController?.abort();
  if (task.releaseEnv) await task.releaseEnv().catch(() => {});
  return true;
}

