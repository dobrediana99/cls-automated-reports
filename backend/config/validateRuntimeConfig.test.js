/**
 * Tests for validateMonthlyRuntimeConfig: fail-fast, operator-friendly errors, no secrets.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateMonthlyRuntimeConfig } from './validateRuntimeConfig.js';

function minimalMonthlyEnv() {
  return {
    MONDAY_API_TOKEN: 'token',
    OPENROUTER_API_KEY: 'key',
    GMAIL_USER: 'u@example.com',
    GMAIL_APP_PASSWORD: 'pass',
    TEST_EMAILS: 'test@example.com',
    SEND_MODE: 'prod',
  };
}

describe('validateMonthlyRuntimeConfig', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('does not throw when dryRun=true and only MONDAY + OPENROUTER set', () => {
    const env = { MONDAY_API_TOKEN: 't', OPENROUTER_API_KEY: 'k' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env })).not.toThrow();
  });

  it('does not throw when dryRun=false with full valid config (prod)', () => {
    const env = minimalMonthlyEnv();
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'prod', env })).not.toThrow();
  });

  it('does not throw when dryRun=false with SEND_MODE=test and TEST_EMAILS set', () => {
    const env = { ...minimalMonthlyEnv(), SEND_MODE: 'test', TEST_EMAILS: 'a@b.com, b@c.com' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'test', env })).not.toThrow();
  });

  it('throws when MONDAY_API_TOKEN missing', () => {
    const env = { OPENROUTER_API_KEY: 'k' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('MONDAY_API_TOKEN must be set');
  });

  it('throws when OPENROUTER_API_KEY missing', () => {
    const env = { MONDAY_API_TOKEN: 't' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('OPENROUTER_API_KEY must be set');
  });

  it('throws when dryRun=false and GMAIL_USER missing', () => {
    const env = { ...minimalMonthlyEnv(), GMAIL_USER: '' };
    delete env.GMAIL_USER;
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'prod', env }))
      .toThrow('GMAIL_USER must be set');
  });

  it('throws when dryRun=false and GMAIL_APP_PASSWORD missing', () => {
    const env = { ...minimalMonthlyEnv(), GMAIL_APP_PASSWORD: '' };
    delete env.GMAIL_APP_PASSWORD;
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'prod', env }))
      .toThrow('GMAIL_APP_PASSWORD must be set');
  });

  it('throws when SEND_MODE=test, dryRun=false and TEST_EMAILS empty', () => {
    const env = { ...minimalMonthlyEnv(), SEND_MODE: 'test', TEST_EMAILS: '' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'test', env }))
      .toThrow('TEST_EMAILS must be set when SEND_MODE=test');
  });

  it('throws when SEND_MODE is not test or prod', () => {
    const env = { ...minimalMonthlyEnv(), SEND_MODE: 'staging' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'staging', env }))
      .toThrow('SEND_MODE must be "test" or "prod"');
  });

  it('OPENROUTER_TIMEOUT_MS must be positive number', () => {
    const env = { ...minimalMonthlyEnv(), OPENROUTER_TIMEOUT_MS: '0' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('OPENROUTER_TIMEOUT_MS');
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('positive number');

    env.OPENROUTER_TIMEOUT_MS = 'abc';
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('OPENROUTER_TIMEOUT_MS');
  });

  it('OPENROUTER_MAX_TOKENS must be positive number', () => {
    const env = { ...minimalMonthlyEnv(), OPENROUTER_MAX_TOKENS: '-1' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('OPENROUTER_MAX_TOKENS');
  });

  it('MONDAY_MAX_CONCURRENT must be integer >= 1', () => {
    const env = { ...minimalMonthlyEnv(), MONDAY_MAX_CONCURRENT: '0' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('MONDAY_MAX_CONCURRENT');
    env.MONDAY_MAX_CONCURRENT = '2.5';
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('MONDAY_MAX_CONCURRENT');
  });

  it('MONDAY_MIN_DELAY_MS must be >= 0', () => {
    const env = { ...minimalMonthlyEnv(), MONDAY_MIN_DELAY_MS: '-1' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('MONDAY_MIN_DELAY_MS');
  });

  it('MONDAY_MAX_ATTEMPTS must be integer >= 1', () => {
    const env = { ...minimalMonthlyEnv(), MONDAY_MAX_ATTEMPTS: '0' };
    expect(() => validateMonthlyRuntimeConfig({ dryRun: true, sendMode: 'test', env }))
      .toThrow('MONDAY_MAX_ATTEMPTS');
  });

  it('error messages do not contain secrets', () => {
    const env = { MONDAY_API_TOKEN: 'secret-token-123', OPENROUTER_API_KEY: 'sk-xxx' };
    try {
      validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'prod', env });
    } catch (e) {
      const msg = e.message || String(e);
      expect(msg).not.toContain('secret-token');
      expect(msg).not.toContain('sk-xxx');
    }
    env.GMAIL_APP_PASSWORD = 'my-secret-pass';
    try {
      validateMonthlyRuntimeConfig({ dryRun: false, sendMode: 'prod', env: { ...env, GMAIL_USER: '' } });
    } catch (e) {
      const msg = e.message || String(e);
      expect(msg).not.toContain('my-secret-pass');
    }
  });
});
