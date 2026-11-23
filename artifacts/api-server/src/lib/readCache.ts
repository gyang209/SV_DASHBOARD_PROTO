/** A bounded stale-while-revalidate cache. Invalidation also detaches old loads. */
export function createReadCache<T>(
  load: () => Promise<T>,
  options: {
    freshMs: number;
    staleMs: number;
    maxStaleMs?: number;
    rateLimitBackoffMs?: number;
    onRefreshError: (error: unknown) => void;
    now?: () => number;
  },
) {
  const now = options.now ?? Date.now;
  let generation = 0;
  let cached: { value: T; loadedAt: number } | null = null;
  let pending: Promise<T> | null = null;
  let rateLimitRetryAt = 0;
  let lastRateLimitError: unknown = null;

  function isRateLimited(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error &&
      error.status === 429;
  }

  function invalidate() {
    generation += 1;
    cached = null;
    pending = null;
    rateLimitRetryAt = 0;
    lastRateLimitError = null;
  }

  function refresh(): Promise<T> {
    if (pending) return pending;
    const startedGeneration = generation;
    const request = Promise.resolve().then(load).then((value) => {
      if (generation === startedGeneration) {
        cached = { value, loadedAt: now() };
      }
      rateLimitRetryAt = 0;
      lastRateLimitError = null;
      return value;
    }).catch((error: unknown) => {
      if (isRateLimited(error)) {
        rateLimitRetryAt = now() + (options.rateLimitBackoffMs ?? 0);
        lastRateLimitError = error;
      } else {
        rateLimitRetryAt = 0;
        lastRateLimitError = null;
      }
      throw error;
    }).finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return request;
  }

  async function get(forceRefresh = false): Promise<T> {
    if (forceRefresh) invalidate();
    if (cached) {
      const age = now() - cached.loadedAt;
      if (age < options.freshMs) return cached.value;
      if (age < options.freshMs + options.staleMs) {
        // Only the request starting a refresh owns its background error handler.
        if (!pending && now() >= rateLimitRetryAt) {
          void refresh().catch(options.onRefreshError);
        }
        return cached.value;
      }
      const maxStaleMs = options.maxStaleMs ?? options.freshMs + options.staleMs;
      if (age < maxStaleMs) {
        if (pending || now() < rateLimitRetryAt) return cached.value;
        try {
          return await refresh();
        } catch (error) {
          options.onRefreshError(error);
          if (isRateLimited(error) && age < maxStaleMs) return cached.value;
          throw error;
        }
      }
    }
    if (lastRateLimitError && now() < rateLimitRetryAt) {
      throw lastRateLimitError;
    }
    // Cold, invalidated, or too-old reads must succeed upstream, never fall back.
    return refresh();
  }

  return { get, invalidate };
}
