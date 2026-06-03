/**
 * Monday.com API client. All requests go through httpClient (concurrency limiter, retry, backoff).
 * This module exposes mondayRequest(query, variables?, operationName?, options?) and returns data only.
 */

import { mondayRequest as mondayRequestHttp } from './httpClient.js';

/**
 * POST a GraphQL request to Monday.com API. Uses httpClient for throttling and retry.
 * @param {string} query - GraphQL query string
 * @param {object} [variables] - Optional variables object
 * @param {string} [operationName] - Optional name for logging (e.g. "columns", "items_page", "timeline")
 * @param {{ maxAttempts?: number, timeoutMs?: number }} [options] - Optional low-level request overrides.
 * @returns {Promise<object>} Parsed JSON data (data property from response)
 */
export async function mondayRequest(query, variables = undefined, operationName = undefined, options = {}) {
  const json = await mondayRequestHttp({
    query,
    variables,
    operationName: operationName ?? 'graphql',
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
  });
  return json.data ?? {};
}
