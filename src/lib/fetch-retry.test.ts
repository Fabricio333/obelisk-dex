import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from './fetch-retry';

describe('fetchWithRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('returns the response on first success', async () => {
    const ok = new Response('ok', { status: 200 });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(ok);
    await expect(fetchWithRetry('/x')).resolves.toBe(ok);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and eventually succeeds', async () => {
    const fail = new Response('err', { status: 503 });
    const ok = new Response('ok', { status: 200 });
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok);
    const p = fetchWithRetry('/x', { backoffMs: 10 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe(ok);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx', async () => {
    const notFound = new Response('nope', { status: 404 });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(notFound);
    await expect(fetchWithRetry('/x')).resolves.toBe(notFound);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on network error and throws after exhaustion', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('net'));
    const p = fetchWithRetry('/x', { retries: 2, backoffMs: 1 });
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow('net');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('honors abort signal', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(fetchWithRetry('/x', { signal: ctrl.signal })).rejects.toThrow();
  });
});
