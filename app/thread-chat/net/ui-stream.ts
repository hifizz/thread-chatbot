/**
 * net/ui-stream —— AI SDK v7「UI Message Stream」的纯 TS 消费器（无 React、无 DOM 依赖）。
 *
 * 服务端 `toUIMessageStreamResponse()` 以 SSE 输出：每个事件是一行
 * `data: ${JSON.stringify(chunk)}`，事件之间用空行（\n\n）分隔，整条流以
 * `data: [DONE]` 收尾。本模块把这条字节流切成一个个 chunk，按类型分派：
 *   - text-delta            → onTextDelta(chunk.delta)（正文增量）
 *   - error                 → onError(chunk.errorText)
 *   - finish / 流自然结束    → onFinish（只回调一次）
 *   - reasoning-* / tool-* / start / 其它未知类型 → 静默跳过
 *     （MiniMax 的 <think> 已被服务端 extractReasoningMiddleware 抽成 reasoning-* chunk，
 *      本 demo 只渲染「思考中…」指示器，不展示 reasoning 内容，故这里丢弃。）
 *
 * signal 被 abort 时静默返回（不外抛 AbortError），已收到的文本由上层保留。
 */

export interface UIStreamHandlers {
  /** 收到一段正文增量（text-delta.delta） */
  onTextDelta(delta: string): void;
  /** 收到 error chunk（errorText 缺失时给出兜底文案） */
  onError(message: string): void;
  /** finish chunk 或流自然结束时回调；实现内部保证只触发一次 */
  onFinish(): void;
}

/** 判断是否为「中止」类异常（fetch/reader 在 abort 时抛出） */
function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === "AbortError"
      : typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError"
  );
}

export async function consumeUIMessageStream(
  res: Response,
  handlers: UIStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  // onFinish 只回调一次（finish chunk 与「流自然结束」可能都想触发）
  const emitFinish = () => {
    if (finished) return;
    finished = true;
    handlers.onFinish();
  };

  /** 处理一个 SSE 事件文本；返回 true 表示遇到 [DONE]，应终止整条流 */
  const handleEvent = (rawEvent: string): boolean => {
    // 一个事件可能包含多行；SSE 规范里同一事件的多个 data: 行以 \n 拼接
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (!line.startsWith("data:")) continue; // 注释行(:...)、event:/id: 等一律忽略
      let d = line.slice(5);
      if (d.startsWith(" ")) d = d.slice(1); // 去掉 "data:" 后的单个前导空格
      dataLines.push(d);
    }
    if (dataLines.length === 0) return false;

    const payload = dataLines.join("\n");
    if (payload === "[DONE]") return true;

    let chunk: { type?: string; delta?: unknown; errorText?: unknown };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return false; // 半个/损坏的 JSON：跳过（跨 chunk 的半行由 buffer 兜住，正常不会到这）
    }

    switch (chunk.type) {
      case "text-delta":
        if (typeof chunk.delta === "string") handlers.onTextDelta(chunk.delta);
        break;
      case "error":
        handlers.onError(
          typeof chunk.errorText === "string" && chunk.errorText ? chunk.errorText : "流式响应发生错误",
        );
        break;
      case "finish":
        emitFinish();
        break;
      default:
        break; // reasoning-* / tool-* / start / text-start / text-end / 未知类型：静默跳过
    }
    return false;
  };

  try {
    let done = false;
    while (!done) {
      if (signal.aborted) return; // 中止：静默返回，保留已收文本
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      // 按空行切出完整事件，最后半个事件留在 buffer 里等下一片
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (handleEvent(rawEvent)) {
          done = true; // 遇到 [DONE]
          break;
        }
      }
    }
    // 流自然结束：处理可能残留的、无末尾空行的最后一个事件
    if (!signal.aborted && buffer.trim().length > 0) handleEvent(buffer);
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return; // 中止：静默
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 忽略：reader 可能已随流关闭
    }
  }

  if (!signal.aborted) emitFinish(); // 流自然结束但没有 finish chunk 时兜底
}
