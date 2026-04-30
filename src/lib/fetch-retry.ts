/**
 * Fetch with retry and exponential backoff for transient failures.
 *
 * Use for boot-time data loads (servers, channels, messages) where a single
 * network blip or 5xx would otherwise leave the UI empty until the user
 * manually refreshes the page. Retries on network errors and 5xx responses;
 * does not retry on 4xx (those are not transient).
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit & { retries?: number; backoffMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const retries = init?.retries ?? 3;
  const backoffMs = init?.backoffMs ?? 300;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      // 4xx is not transient — return immediately so caller can handle.
      if (res.status >= 400 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      lastErr = err;
    }
    if (attempt < retries) {
      const delay = backoffMs * Math.pow(3, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error('fetchWithRetry: exhausted retries');
}
