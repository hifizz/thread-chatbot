// ACP（Agent Client Protocol）桥：在 e2b 沙箱内以交互式后台进程方式运行
// `devin acp`，通过 stdin/stdout 走行分隔 JSON-RPC，把 session/update
// 通知映射为规范化的 TaskEvent。

import type { CommandHandle, Sandbox } from "e2b";
import type { TaskEvent } from "@/lib/agent-demo/contracts";

type JsonRpc = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** ACP session/update 通知里我们关心的字段（宽松结构）。 */
type SessionUpdate = {
  sessionUpdate?: string;
  content?: { type: string; text?: string };
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  _meta?: { [key: string]: unknown };
  [key: string]: unknown;
};

export class AcpBridge {
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private buf = "";
  private sessionId: string | null = null;
  private messageBlockId: string | null = null;
  private thoughtBlockId: string | null = null;
  private exited: Promise<unknown>;
  private _lastMessage = "";

  /** 本轮 prompt 累积的正文（用于结果摘要）。 */
  get lastMessage(): string {
    return this._lastMessage;
  }

  private constructor(
    private readonly sandbox: Sandbox,
    private readonly handle: CommandHandle,
    private readonly emitEvent: (payload: TaskEvent) => void
  ) {
    this.exited = handle.wait().catch(() => {});
  }

  /** 在沙箱内启动 `devin acp` 并完成 initialize + session/new。 */
  static async start(input: {
    sandbox: Sandbox;
    cwd: string;
    devinBin: string;
    emitEvent: (payload: TaskEvent) => void;
  }): Promise<AcpBridge> {
    // onStdout 可能早于 bridge 赋值触发，先缓冲再回放
    let bridge: AcpBridge | null = null;
    let preBuf = "";
    const handle = await input.sandbox.commands.run(`${input.devinBin} acp`, {
      background: true,
      stdin: true,
      cwd: input.cwd,
      timeoutMs: 0,
      onStdout: (data: string) => {
        if (bridge) bridge.feedStdout(data);
        else preBuf += data;
      },
      // acp 的 INFO 日志走 stderr，不进事件流（避免噪音与泄露）
      onStderr: () => {},
    });
    bridge = new AcpBridge(input.sandbox, handle, input.emitEvent);
    if (preBuf) bridge.feedStdout(preBuf);

    await bridge.request("initialize", {
      protocolVersion: 1,
      // 不声明 fs/terminal：让 agent 用自己的工具执行，否则写文件会反向委托给
      // client 且我们不应答时会永久卡住。
      clientCapabilities: {},
      clientInfo: { name: "thread-chat-agent-demo", version: "0.1.0" },
    });
    const sess = (await bridge.request("session/new", {
      cwd: input.cwd,
      mcpServers: [],
    })) as { sessionId: string };
    bridge.sessionId = sess.sessionId;
    return bridge;
  }

  private feedStdout(data: string) {
    this.buf += data;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpc) {
    // 响应（无 method 且带 id）
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`ACP ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // agent → client 的请求：权限请求自动批准（git 变更类命令除外——
      // commit/push/PR 是 runner 的职责），其余声明不支持
      if (msg.method === "session/request_permission") {
        const params = msg.params as {
          options?: { optionId: string; kind?: string }[];
          toolCall?: { title?: string; rawInput?: unknown };
        };
        const cmdText = `${params.toolCall?.title ?? ""} ${JSON.stringify(params.toolCall?.rawInput ?? "")}`;
        const forbidden = /\bgit\s+(commit|push|config|remote|checkout|switch|merge|rebase|reset)\b/.test(cmdText);
        const pick = (kind: string) => params.options?.find((o) => o.kind?.includes(kind)) ?? params.options?.[0];
        const opt = forbidden ? pick("reject") : pick("allow");
        void this.respond(msg.id, { outcome: { outcome: "selected", optionId: opt?.optionId } });
      } else {
        void this.sendRaw({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not implemented" } });
      }
      return;
    }
    if (msg.method === "session/update") {
      this.mapUpdate((msg.params as { update?: SessionUpdate })?.update ?? {});
    }
  }

  private mapUpdate(u: SessionUpdate) {
    switch (u.sessionUpdate) {
      case "agent_thought_chunk": {
        const text = u.content?.text ?? "";
        if (!text) break;
        this.thoughtBlockId ??= `acp-thought-${crypto.randomUUID().slice(0, 8)}`;
        this.emitEvent({ type: "agent.thinking.delta", messageId: this.thoughtBlockId, blockId: this.thoughtBlockId, text });
        break;
      }
      case "agent_message_chunk": {
        const text = u.content?.text ?? "";
        if (!text) break;
        if (!this.messageBlockId) {
          this.messageBlockId = `acp-msg-${crypto.randomUUID().slice(0, 8)}`;
          this.emitEvent({ type: "agent.message.started", messageId: this.messageBlockId });
        }
        this._lastMessage += text;
        this.emitEvent({ type: "agent.text.delta", messageId: this.messageBlockId, blockId: this.messageBlockId, text });
        break;
      }
      case "tool_call": {
        const name =
          (u._meta?.["cognition.ai/inferenceToolName"] as string | undefined) ??
          u.title ??
          "tool";
        this.emitEvent({
          type: "tool.started",
          toolCallId: String(u.toolCallId),
          name: String(name),
          input: { title: u.title, kind: u.kind } as never,
        });
        break;
      }
      case "tool_call_update": {
        // diff/content 更新作为输出增量；状态收尾作为 finished
        const status = u.status;
        if (status === "completed" || status === "failed") {
          this.emitEvent({
            type: "tool.finished",
            toolCallId: String(u.toolCallId),
            isError: status === "failed",
            output: (u.content ?? u.rawOutput ?? null) as never,
          });
        } else if (u.content) {
          this.emitEvent({
            type: "tool.output.updated",
            toolCallId: String(u.toolCallId),
            mode: "replace",
            output: JSON.stringify(u.content),
          });
        }
        break;
      }
      default:
        break; // plan/usage/commands/mode 等更新暂不映射
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId;
    const p = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    void this.sendRaw({ jsonrpc: "2.0", id, method, params });
    return p;
  }

  private respond(id: number, result: unknown): Promise<void> {
    return this.sendRaw({ jsonrpc: "2.0", id, result });
  }

  private sendRaw(msg: JsonRpc): Promise<void> {
    return this.handle.sendStdin(JSON.stringify(msg) + "\n");
  }

  /** 发送 prompt，返回 stopReason；中途的 session/update 已映射为事件。 */
  async prompt(text: string): Promise<{ stopReason: string }> {
    if (!this.sessionId) throw new Error("ACP session 未建立");
    this.messageBlockId = null;
    this.thoughtBlockId = null;
    this._lastMessage = "";
    const resp = (await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    })) as { stopReason: string };
    return resp;
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    void this.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
  }

  async close(): Promise<void> {
    try {
      await this.sandbox.commands.kill(this.handle.pid);
    } catch {
      /* 沙箱可能已销毁 */
    }
    await this.exited;
  }
}
