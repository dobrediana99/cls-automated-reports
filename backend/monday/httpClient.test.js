import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mondayRequest } from './httpClient.js';

const originalEnv = process.env;
let mockFetch;

/** Response body is read via .text() in httpClient; use this to build a mock response. */
function mockResponse({ ok = true, status = 200, body = {}, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    headers: { get: (n) => headers[n] ?? null },
    text: async () => text,
  };
}

describe('httpClient mondayRequest', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, MONDAY_API_TOKEN: 'test-token' };
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws if MONDAY_API_TOKEN is not set', async () => {
    delete process.env.MONDAY_API_TOKEN;
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow('MONDAY_API_TOKEN is not set');
  });

  it('returns json on 200 with data', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: { data: { boards: [] } } }));
    const result = await mondayRequest({ query: 'query { boards { id } }' });
    expect(result).toEqual({ data: { boards: [] } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('on 429 retries up to maxAttempts then throws', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '3';
    mockFetch.mockResolvedValue(
      mockResponse({ ok: false, status: 429, body: {} }),
    );
    await expect(mondayRequest({ query: 'query { x }', operationName: 'test' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('on 429 with Retry-After uses it as minimum delay', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '2';
    const start = Date.now();
    mockFetch
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 429, body: {}, headers: { 'Retry-After': '1' } }),
      )
      .mockResolvedValueOnce(mockResponse({ body: { data: {} } }));
    await mondayRequest({ query: 'query { x }' });
    const elapsed = Date.now() - start;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('does NOT retry on 401', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 401, body: { error_message: 'Unauthorized' } }),
    );
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 403, body: {} }),
    );
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on GraphQL 200+errors when message contains 429', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '3';
    mockFetch
      .mockResolvedValueOnce(
        mockResponse({
          body: { errors: [{ message: 'Internal Request Error in column_values - 429' }] },
        }),
      )
      .mockResolvedValueOnce(mockResponse({ body: { data: { ok: true } } }));
    const result = await mondayRequest({ query: 'query { x }', operationName: 'column_values' });
    expect(result).toEqual({ data: { ok: true } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on GraphQL 200+errors when message is not rate-limit', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ body: { errors: [{ message: 'Invalid query syntax' }] } }),
    );
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow('Invalid query syntax');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('limits concurrency to MONDAY_MAX_CONCURRENT', async () => {
    process.env.MONDAY_MAX_CONCURRENT = '2';
    process.env.MONDAY_MIN_DELAY_MS = '0';
    let concurrent = 0;
    let maxConcurrent = 0;
    mockFetch.mockImplementation(async () => {
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return mockResponse({ body: { data: {} } });
    });
    await Promise.all([
      mondayRequest({ query: 'q1' }),
      mondayRequest({ query: 'q2' }),
      mondayRequest({ query: 'q3' }),
      mondayRequest({ query: 'q4' }),
      mondayRequest({ query: 'q5' }),
    ]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('clears timeout on fetch throw so retry is not ghost-aborted', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '2';
    const networkErr = new TypeError('fetch failed');
    mockFetch
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce(mockResponse({ body: { data: { ok: true } } }));
    const result = await mondayRequest({ query: 'query { x }', operationName: 'test' });
    expect(result).toEqual({ data: { ok: true } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
