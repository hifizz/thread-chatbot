/** 终态 Session 保留时间：允许首次 SSE 稍晚建立或短暂重订阅。 */
export const THREAD_CHAT_SESSION_TERMINAL_TTL_MS = 5 * 60_000

/** 清理频率低于 TTL，避免终态 Session 长期占用进程内存。 */
export const THREAD_CHAT_SESSION_CLEANUP_INTERVAL_MS = 60_000

/** SSE 心跳用于穿过 VPS 反向代理的空闲连接回收。 */
export const THREAD_CHAT_STREAM_HEARTBEAT_MS = 15_000

/** generating parts 的数据库 checkpoint 节流窗口。 */
export const THREAD_CHAT_CHECKPOINT_THROTTLE_MS = 850

/** SSE 断开后的终态轮询退避；最后一项是持续轮询上限。 */
export const THREAD_CHAT_TERMINAL_POLL_DELAYS_MS = [
  1_000, 2_000, 2_000, 3_000, 5_000,
] as const

/** 客户端等待 AI SDK reducer 重放 barrier 的上限；超时后放弃 SSE 并转轮询。 */
export const THREAD_CHAT_REDUCER_FLUSH_TIMEOUT_MS = 15_000
