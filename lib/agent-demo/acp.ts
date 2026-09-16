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
  private logFile = "";
  private fileOffset = 0;
  private filePollTimer: ReturnType<typeof setInterval> | null = null;
  private pollFailures = 0;
  private pollIncidentId: string | null = null;
  private closed = false;

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
    // 进程退出（含沙箱被 e2b 超时杀掉）时，pending 请求必须全部 reject——
    // 否则 acp.prompt 永久悬挂，任务卡死在 running。
    void this.exited.then(() => {
      const err = new Error("devin acp 进程已退出（沙箱可能已回收）");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  /** 在沙箱内启动 `devin acp` 并完成 initialize + session/new。
   *  e2b 的 onStdout 推送曾实测中途静默断开，因此 acp 的 stdout 同时 tee 到
   *  日志文件，并以轮询文件作为权威事件源（onStdout 仅作加速，按行内容去重）。 */
  static async start(input: {
    sandbox: Sandbox;
    cwd: string;
    devinBin: string;
    emitEvent: (payload: TaskEvent) => void;
  }): Promise<AcpBridge> {
    const logFile = `/tmp/devin-acp-${crypto.randomUUID().slice(0, 8)}.jsonl`;
    // e2b 的 onStdout 推送实测会中途静默断开，因此 stdout 用 tee 落盘，
    // 事件统一从日志文件轮询读取（onStdout 只排空不用）。
    // --model 固定 swe-2-high：沙箱内没有 config.json，不指定就走组织默认，
    // 可能命中计费模型；SWE-2 全家在当前 Teams 账号下标注 Free。
    const handle = await input.sandbox.commands.run(
      `bash -lc ${JSON.stringify(`${input.devinBin} acp --model swe-2-high 2>/dev/null | tee -a ${logFile}`)}`,
      {
        background: true,
        stdin: true,
        cwd: input.cwd,
        timeoutMs: 0,
        onStdout: () => {},
        onStderr: () => {},
      }
    );
    const bridge = new AcpBridge(input.sandbox, handle, input.emitEvent);
    bridge.logFile = logFile;
    bridge.startFilePoller();

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

  /** 每 1.2s 从 tee 落盘的 jsonl 文件增量读取，作为唯一权威事件源。
   *  e2b API 偶发抖动会让 files.read 连续失败——失败后持续重试即可恢复
   *  （文件在沙箱内持续累积，恢复后一次性补读）；连续失败时发伪工具事件
   *  让页面可见"在重连"而不是无声卡死。 */
  private startFilePoller() {
    this.filePollTimer = setInterval(() => {
      if (this.closed) return;
      void this.sandbox.files
        .read(this.logFile)
        .then((text) => {
          if (this.pollFailures > 0) this.reportPollRecovered();
          if (text.length <= this.fileOffset) return;
          const fresh = text.slice(this.fileOffset);
          this.fileOffset = text.length;
          this.feedStdout(fresh);
        })
        .catch((err) => this.reportPollFailure(err));
    }, 1200);
  }

  private reportPollFailure(err: unknown) {
    this.pollFailures += 1;
    if (this.pollFailures === 3) {
      this.pollIncidentId = `env-sync-${crypto.randomUUID().slice(0, 8)}`;
      this.emitEvent({
        type: "tool.started",
        toolCallId: this.pollIncidentId,
        name: "event-stream",
        input: { title: "事件流同步" } as never,
      });
      this.emitEvent({
        type: "tool.output.updated",
        toolCallId: this.pollIncidentId,
        mode: "append",
        output: `沙箱连接抖动，事件流读取失败（${err instanceof Error ? err.message : String(err)}），后台重试中…`,
      });
    }
  }

  private reportPollRecovered() {
    const id = this.pollIncidentId;
    this.pollFailures = 0;
    this.pollIncidentId = null;
    if (!id) return;
    this.emitEvent({ type: "tool.output.updated", toolCallId: id, mode: "append", output: "\n连接恢复，补读中断期间的事件。" });
    this.emitEvent({ type: "tool.finished", toolCallId: id, isError: false, output: null });
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
    void this.sendRaw({ jsonrpc: "2.0", id, method, params }).catch((err) => {
      // 请求本身没送达（stdin 通道故障）时必须 reject，否则 pending 永久悬挂
      const pendingReq = this.pending.get(id);
      if (pendingReq) {
        this.pending.delete(id);
        pendingReq.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return p;
  }

  private respond(id: number, result: unknown): Promise<void> {
    return this.sendRaw({ jsonrpc: "2.0", id, result });
  }

  /** stdin 写入带重试：e2b 通道瞬断时权限应答/控制消息不能静默丢失——
   *  devin 会永远等待未被应答的 request_permission。 */
  private async sendRaw(msg: JsonRpc): Promise<void> {
    const line = JSON.stringify(msg) + "\n";
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.handle.sendStdin(line);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
    this.closed = true;
    if (this.filePollTimer) clearInterval(this.filePollTimer);
    try {
      await this.sandbox.commands.kill(this.handle.pid);
    } catch {
      /* 沙箱可能已销毁 */
    }
    await this.exited;
  }
}
