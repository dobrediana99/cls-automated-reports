/**
 * Unit tests for parseJsonFromText: direct JSON, JSON in fences, text + JSON, invalid -> throw.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonFromText } from './parseJsonFromText.js';

const validObj = { a: 1, b: 'x' };
const validStr = '{"a":1,"b":"x"}';

describe('parseJsonFromText', () => {
  it('parses JSON direct', () => {
    expect(parseJsonFromText(validStr)).toEqual(validObj);
  });

  it('parses JSON in ``` fences', () => {
    const wrapped = '```json\n' + validStr + '\n```';
    expect(parseJsonFromText(wrapped)).toEqual(validObj);
  });

  it('parses JSON in ``` without language', () => {
    const wrapped = '```\n' + validStr + '\n```';
    expect(parseJsonFromText(wrapped)).toEqual(validObj);
  });

  it('parses JSON from text + JSON (extracts first { to last })', () => {
    const text = 'Here is the result:\n' + validStr + '\nEnd.';
    expect(parseJsonFromText(text)).toEqual(validObj);
  });

  it('parses when text has leading/trailing and JSON in middle', () => {
    const text = 'Answer:\n{"a":1,"b":"x"}\nDone.';
    expect(parseJsonFromText(text)).toEqual(validObj);
  });

  it('throws on non-JSON string', () => {
    expect(() => parseJsonFromText('not json')).toThrow('LLM returned non-JSON');
  });

  it('throws on empty string', () => {
    expect(() => parseJsonFromText('')).toThrow('LLM returned non-JSON');
  });

  it('throws on null input', () => {
    expect(() => parseJsonFromText(null)).toThrow('LLM returned non-JSON');
  });

  it('throws when no { } present', () => {
    expect(() => parseJsonFromText('no braces here')).toThrow('LLM returned non-JSON');
  });

  it('throws when invalid JSON between braces', () => {
    expect(() => parseJsonFromText('prefix { invalid } suffix')).toThrow('LLM returned non-JSON');
  });
});
