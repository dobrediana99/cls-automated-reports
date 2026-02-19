/**
 * Lightweight docs-consistency test: ensure backend/ENV.md documents key defaults that match code.
 * Only a small critical subset (OpenRouter defaults). Fails if ENV.md is updated without code or vice versa.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  OPENROUTER_DEFAULT_MAX_TOKENS,
  OPENROUTER_DEFAULT_TIMEOUT_MS,
} from '../llm/openrouterClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_MD_PATH = path.join(__dirname, '..', 'ENV.md');

describe('docs consistency (ENV.md vs code defaults)', () => {
  it('ENV.md documents OPENROUTER_MAX_TOKENS default matching code', () => {
    const content = fs.readFileSync(ENV_MD_PATH, 'utf8');
    const tokenDefault = String(OPENROUTER_DEFAULT_MAX_TOKENS);
    expect(
      content.includes(`OPENROUTER_MAX_TOKENS`) && content.includes(tokenDefault),
      `ENV.md should document OPENROUTER_MAX_TOKENS default as ${tokenDefault}`
    ).toBe(true);
  });

  it('ENV.md documents OPENROUTER_TIMEOUT_MS default matching code', () => {
    const content = fs.readFileSync(ENV_MD_PATH, 'utf8');
    const timeoutDefault = String(OPENROUTER_DEFAULT_TIMEOUT_MS);
    expect(
      content.includes(`OPENROUTER_TIMEOUT_MS`) && content.includes(timeoutDefault),
      `ENV.md should document OPENROUTER_TIMEOUT_MS default as ${timeoutDefault}`
    ).toBe(true);
  });
});
