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

/**
 * 多实例生成所有权：运行实例按此间隔刷新 messages.generation_heartbeat_at，
 * 同一次 UPDATE 顺带读回 stop/supersede 标志，作为跨实例停止通道。
 */
export const THREAD_CHAT_GENERATION_HEARTBEAT_MS = 10_000

/** 控制标志（stopRequestedAt/supersededAt）的轻量 SELECT 轮询间隔。 */
export const THREAD_CHAT_GENERATION_CONTROL_POLL_MS = 2_000

/**
 * 心跳超过此窗口未刷新即认定属主实例已死亡，允许其他实例清扫接管。
 * 必须显著大于 HEARTBEAT（容忍排队/慢写），否则会把活实例的生成误判成孤儿。
 */
export const THREAD_CHAT_GENERATION_HEARTBEAT_STALE_MS = 45_000

/** 周期性孤儿生成清扫间隔（启动时的一次性清扫之外补充多实例场景）。 */
export const THREAD_CHAT_ORPHAN_SWEEP_INTERVAL_MS = 60_000
