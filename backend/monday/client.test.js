import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mondayRequest } from './client.js';

describe('mondayRequest', () => {
  const originalEnv = process.env;
  const mockFetch = vi.fn();

  beforeEach(() => {
    process.env = { ...originalEnv, MONDAY_API_TOKEN: 'test-token' };
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    mockFetch.mockReset();
  });

  it('throws if MONDAY_API_TOKEN is not set', async () => {
    delete process.env.MONDAY_API_TOKEN;
    await expect(mondayRequest('query { boards { id } }')).rejects.toThrow('MONDAY_API_TOKEN is not set');
  });

  it('POSTs to Monday API with correct headers and body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { boards: [] } }),
    });
    await mondayRequest('query { boards { id } }');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.monday.com/v2',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'test-token',
        },
        body: JSON.stringify({ query: 'query { boards { id } }' }),
      })
    );
  });

  it('sends variables when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    });
    await mondayRequest('query($id: ID!) { board(id: $id) { id } }', { id: '123' });
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.query).toContain('$id');
    expect(callBody.variables).toEqual({ id: '123' });
  });

  it('throws on GraphQL errors in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'Invalid query' }] }),
    });
    await expect(mondayRequest('query { x }')).rejects.toThrow('Invalid query');
  });

  it('throws on HTTP 4xx (non-retryable)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error_message: 'Unauthorized' }),
    });
    await expect(mondayRequest('query { x }')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on HTTP 5xx and succeeds on second attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { boards: [] } }),
      });
    const result = await mondayRequest('query { boards { id } }');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ boards: [] });
  });

  it('throws error with statusCode on 429 after retries exhausted', async () => {
    process.env.MONDAY_MAX_ATTEMPTS = '3';
    const resp429 = {
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ error_message: 'Too Many Requests' }),
    };
    mockFetch.mockResolvedValue(resp429);
    try {
      await mondayRequest('query { x }');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).toContain('Too Many Requests');
      expect(err.statusCode).toBe(429);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15000);
});
