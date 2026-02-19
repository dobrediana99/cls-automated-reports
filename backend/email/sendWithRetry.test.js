/**
 * Unit tests for sendWithRetry: transient vs permanent classification and retry config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTransientSendError, getRetryConfig, sendWithRetry } from './sendWithRetry.js';

describe('sendWithRetry', () => {
  describe('isTransientSendError', () => {
    it('treats ECONNECTION, ETIMEDOUT, ECONNRESET as transient', () => {
      expect(isTransientSendError({ code: 'ECONNECTION', message: 'x' }).transient).toBe(true);
      expect(isTransientSendError({ code: 'ETIMEDOUT', message: 'x' }).transient).toBe(true);
      expect(isTransientSendError({ code: 'ECONNRESET', message: 'x' }).transient).toBe(true);
    });

    it('treats EAUTH, ENOAUTH as permanent', () => {
      expect(isTransientSendError({ code: 'EAUTH', message: 'Invalid login' }).transient).toBe(false);
      expect(isTransientSendError({ code: 'ENOAUTH', message: 'x' }).transient).toBe(false);
    });

    it('treats message "authentication failed" as permanent', () => {
      expect(isTransientSendError(new Error('authentication failed')).transient).toBe(false);
    });

    it('treats message "Connection timeout" as transient', () => {
      expect(isTransientSendError(new Error('Connection timeout')).transient).toBe(true);
    });

    it('returns reason string', () => {
      expect(isTransientSendError({ code: 'EAUTH' }).reason).toBe('permanent');
      expect(isTransientSendError({ code: 'ETIMEDOUT' }).reason).toBe('transient');
    });
  });

  describe('getRetryConfig', () => {
    const orig = {};
    beforeEach(() => {
      orig.EMAIL_SEND_MAX_ATTEMPTS = process.env.EMAIL_SEND_MAX_ATTEMPTS;
      orig.EMAIL_SEND_BACKOFF_MS = process.env.EMAIL_SEND_BACKOFF_MS;
      delete process.env.EMAIL_SEND_MAX_ATTEMPTS;
      delete process.env.EMAIL_SEND_BACKOFF_MS;
    });
    afterEach(() => {
      if (orig.EMAIL_SEND_MAX_ATTEMPTS != null) process.env.EMAIL_SEND_MAX_ATTEMPTS = orig.EMAIL_SEND_MAX_ATTEMPTS;
      if (orig.EMAIL_SEND_BACKOFF_MS != null) process.env.EMAIL_SEND_BACKOFF_MS = orig.EMAIL_SEND_BACKOFF_MS;
    });

    it('returns default maxAttempts 3 and initialBackoffMs 1000 when env unset', () => {
      const c = getRetryConfig();
      expect(c.maxAttempts).toBe(3);
      expect(c.initialBackoffMs).toBe(1000);
    });

    it('reads EMAIL_SEND_MAX_ATTEMPTS and EMAIL_SEND_BACKOFF_MS from env', () => {
      process.env.EMAIL_SEND_MAX_ATTEMPTS = '5';
      process.env.EMAIL_SEND_BACKOFF_MS = '2000';
      const c = getRetryConfig();
      expect(c.maxAttempts).toBe(5);
      expect(c.initialBackoffMs).toBe(2000);
    });
  });

  describe('sendWithRetry', () => {
    it('resolves on first success', async () => {
      const sendMail = vi.fn().mockResolvedValue({ messageId: '1' });
      const transporter = { sendMail };
      const result = await sendWithRetry(transporter, { to: 'a@b.com' }, { context: 'test' });
      expect(result).toEqual({ messageId: '1' });
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('retries on transient then succeeds', async () => {
      const sendMail = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
        .mockResolvedValueOnce({ messageId: '1' });
      const transporter = { sendMail };
      const result = await sendWithRetry(transporter, { to: 'a@b.com' }, { context: 'test', maxAttempts: 3 });
      expect(result).toEqual({ messageId: '1' });
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    it('throws on permanent error without retry', async () => {
      const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));
      const transporter = { sendMail };
      await expect(sendWithRetry(transporter, { to: 'a@b.com' }, { context: 'test' })).rejects.toThrow('Invalid login');
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries on transient', async () => {
      const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('Connection closed'), { code: 'ECONNECTION' }));
      const transporter = { sendMail };
      await expect(
        sendWithRetry(transporter, { to: 'a@b.com' }, { context: 'test', maxAttempts: 3, initialBackoffMs: 0 })
      ).rejects.toThrow('Connection closed');
      expect(sendMail).toHaveBeenCalledTimes(3);
    }, 8000);
  });
});
