/**
 * Monday.com API client. All requests go through httpClient (concurrency limiter, retry, backoff).
 * This module exposes mondayRequest(query, variables?, operationName?) and returns data only.
 */

import { mondayRequest as mondayRequestHttp } from './httpClient.js';

/**
 * POST a GraphQL request to Monday.com API. Uses httpClient for throttling and retry.
 * @param {string} query - GraphQL query string
 * @param {object} [variables] - Optional variables object
 * @param {string} [operationName] - Optional name for logging (e.g. "columns", "items_page", "timeline")
 * @returns {Promise<object>} Parsed JSON data (data property from response)
 */
export async function mondayRequest(query, variables = undefined, operationName = undefined) {
  const json = await mondayRequestHttp({
    query,
    variables,
    operationName: operationName ?? 'graphql',
  });
  return json.data ?? {};
}
