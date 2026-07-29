/**
 * 为浏览器端昂贵异步资源提供并发去重；失败不会被永久缓存，下一次调用可重试。
 */
export function createRetryableSingleton<T>(
  factory: () => Promise<T>,
): () => Promise<T> {
  let value: T | null = null;
  let pending: Promise<T> | null = null;

  return () => {
    if (value !== null) return Promise.resolve(value);
    if (pending) return pending;

    pending = factory().then(
      (created) => {
        value = created;
        pending = null;
        return created;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );

    return pending;
  };
}
