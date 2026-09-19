/**
 * 部署运行时常量：drain、健康探测与进程收尾的边界值。
 * Fly kill_timeout 上限 300s，但研究型 Generation 可达 ~15min，
 * 因此计划内替换必须靠部署前 drain，信号内收尾只处理有界剩余工作。
 */

/** 收到终止信号后等待在途 Generation 收尾的上限；超时直接退出，由心跳清扫兜底。 */
export const RUNTIME_DRAIN_TIMEOUT_MS = 20_000

/** readiness 的 DB 探测超时；探测结果做短缓存，避免每次健康检查都打到数据库。 */
export const RUNTIME_READYZ_DB_TIMEOUT_MS = 2_000
export const RUNTIME_READYZ_CACHE_MS = 2_000

/** 退出前遥测 flush 上限；日志/追踪是可选副作用，不允许无限阻塞进程退出。 */
export const RUNTIME_TELEMETRY_FLUSH_TIMEOUT_MS = 5_000
