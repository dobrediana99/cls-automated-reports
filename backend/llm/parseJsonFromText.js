/**
 * Extract a single JSON object from raw LLM output (may be wrapped in markdown or text).
 * No guessing or fallback structure: if valid JSON cannot be extracted, throws.
 * @param {string} raw - Raw response content from LLM
 * @returns {object} Parsed JSON object
 * @throws {Error} "LLM returned non-JSON" with message detail if parse fails
 */
export function parseJsonFromText(raw) {
  if (raw == null || typeof raw !== 'string') {
    throw new Error('LLM returned non-JSON: input is not a string.');
  }

  let text = raw.trim();
  if (!text) {
    throw new Error('LLM returned non-JSON: empty response.');
  }

  // 1) Try direct parse
  try {
    return JSON.parse(text);
  } catch (_) {
    // continue to strip and extract
  }

  // 2) Strip markdown fence (```json ... ``` or ``` ... ```)
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    if (lines.length >= 2) {
      const firstLine = lines[0].trim();
      const lastLine = lines[lines.length - 1].trim();
      if (firstLine.startsWith('```') && lastLine === '```') {
        text = lines.slice(1, -1).join('\n').trim();
      }
    }
  }

  // 3) Extract substring between first { and last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = text.slice(start, end + 1).trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      try {
        return JSON.parse(candidate);
      } catch (_) {
        // fall through to throw
      }
    }
  }

  throw new Error(
    'LLM returned non-JSON. Response could not be parsed as a single JSON object (no valid {...} found or parse failed).'
  );
}
