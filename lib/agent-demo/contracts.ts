// 方案 §5/§7 的最小契约：本 demo 用本地进程代替 boxd+Pi、内存表代替 Postgres，
// 但事件形状、seq 语义与状态机按正式方案保留，便于后续换成真实实现。

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AgentEvent =
  | { type: "agent.started" }
  | { type: "agent.message.started"; messageId: string }
  | { type: "agent.text.delta"; messageId: string; blockId: string; text: string }
  | { type: "agent.thinking.delta"; messageId: string; blockId: string; text: string }
  | { type: "tool.started"; toolCallId: string; name: string; input: Json }
  | { type: "tool.output.updated"; toolCallId: string; mode: "append" | "replace"; output: Json }
  | { type: "tool.finished"; toolCallId: string; isError: boolean; output: Json };

export type TaskError = {
  code: string;
  source: "task" | "environment" | "runner";
  userMessage: string;
};

export type TaskResult = {
  outcome: "delivered" | "partial" | "failed" | "cancelled";
  summary: string;
  changedFiles: string[];
  verification: { label: string; status: "passed" | "failed" | "not_run"; detail: string }[];
  commitSha: string | null;
  pullRequest: { url: string; number: number; headSha: string } | null;
};

export type TaskEvent =
  | AgentEvent
  | { type: "task.created"; title: string }
  | { type: "run.status.changed"; status: RunStatus }
  | { type: "phase.changed"; phase: string; label: string }
  | { type: "run.result.saved"; result: TaskResult }
  | { type: "run.error"; error: TaskError };

export type StoredEvent = {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  seq: number;
  sourceEventId: string;
  occurredAt: string;
  payload: TaskEvent;
};

export type TaskSnapshot = {
  taskId: string;
  currentRunId: string;
  status: TaskStatus;
  phase: string | null;
  lastSeq: number;
  repo: string;
  branch: string;
  environment: string;
  workspacePath: string;
  result: TaskResult | null;
  error: TaskError | null;
};
