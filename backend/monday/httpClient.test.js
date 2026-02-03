import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mondayRequest } from './httpClient.js';

const originalEnv = process.env;
let mockFetch;

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ data: { boards: [] } }),
    });
    const result = await mondayRequest({ query: 'query { boards { id } }' });
    expect(result).toEqual({ data: { boards: [] } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('on 429 retries up to maxAttempts then throws', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '3';
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
    });
    await expect(mondayRequest({ query: 'query { x }', operationName: 'test' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('on 429 with Retry-After uses it as minimum delay', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '2';
    const start = Date.now();
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (n) => (n === 'Retry-After' ? '1' : null) },
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ data: {} }),
      });
    await mondayRequest({ query: 'query { x }' });
    const elapsed = Date.now() - start;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('does NOT retry on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ error_message: 'Unauthorized' }),
    });
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({}),
    });
    await expect(mondayRequest({ query: 'query { x }' })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on GraphQL 200+errors when message contains 429', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '3';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ errors: [{ message: 'Internal Request Error in column_values - 429' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ data: { ok: true } }),
      });
    const result = await mondayRequest({ query: 'query { x }', operationName: 'column_values' });
    expect(result).toEqual({ data: { ok: true } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on GraphQL 200+errors when message is not rate-limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ errors: [{ message: 'Invalid query syntax' }] }),
    });
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
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ data: {} }),
      };
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
});
