import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRecipients, resolveSubject, getSendMode, getTestEmails } from './sender.js';

const originalEnv = process.env;

describe('sender (resolveRecipients / resolveSubject)', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('test mode + empty TEST_EMAILS throws when resolveRecipients is called', () => {
    process.env.SEND_MODE = 'test';
    process.env.TEST_EMAILS = '';

    expect(() => resolveRecipients(['real@example.com'])).toThrow(
      'TEST_EMAILS must be set when SEND_MODE=test'
    );
  });

  it('test mode overrides recipients with TEST_EMAILS list', () => {
    process.env.SEND_MODE = 'test';
    process.env.TEST_EMAILS = 'a@b.com, b@c.com';

    const result = resolveRecipients(['real@example.com', 'other@example.com']);
    expect(result).toEqual(['a@b.com', 'b@c.com']);
  });

  it('prod mode returns original recipients', () => {
    process.env.SEND_MODE = 'prod';
    process.env.TEST_EMAILS = 'test@test.com';

    const real = ['user@company.com', 'manager@company.com'];
    const result = resolveRecipients(real);
    expect(result).toEqual(['user@company.com', 'manager@company.com']);
  });

  it('subject is prefixed with [TEST] only in test mode', () => {
    process.env.SEND_MODE = 'test';
    expect(resolveSubject('Raport săptămânal')).toBe('[TEST] Raport săptămânal');

    process.env.SEND_MODE = 'prod';
    expect(resolveSubject('Raport săptămânal')).toBe('Raport săptămânal');
  });

  it('missing SEND_MODE is treated as test (default)', () => {
    delete process.env.SEND_MODE;
    process.env.TEST_EMAILS = 'only@test.com';
    expect(getSendMode()).toBe('test');
    expect(resolveRecipients(['real@x.com'])).toEqual(['only@test.com']);
    expect(resolveSubject('Hello')).toBe('[TEST] Hello');
  });

  it('getTestEmails trims and filters empty', () => {
    process.env.TEST_EMAILS = ' a@b.com , , b@c.com ';
    expect(getTestEmails()).toEqual(['a@b.com', 'b@c.com']);
  });
});
