import { describe, it, expect } from 'vitest';
import { sanitizeReportHtml } from './sanitize.js';

describe('sanitizeReportHtml', () => {
  it('removes script and img tags', () => {
    const html = '<p>OK</p><script>alert(1)</script><img src="x" onerror="alert(1)">';
    const out = sanitizeReportHtml(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('<p>OK</p>');
  });

  it('keeps p, ul, li, a tags', () => {
    const html = '<p>Text</p><ul><li>Item</li></ul><a href="https://example.com">Link</a>';
    const out = sanitizeReportHtml(html);
    expect(out).toContain('<p>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('<a');
    expect(out).toContain('Link</a>');
  });

  it('adds or preserves rel on target="_blank" links when attributes are kept', () => {
    const html = '<a href="https://example.com" target="_blank">Open</a>';
    const out = sanitizeReportHtml(html);
    if (out.includes('target')) {
      expect(out).toContain('noopener');
    }
    expect(out).toContain('<a');
  });

  it('returns empty string for null or non-string', () => {
    expect(sanitizeReportHtml(null)).toBe('');
    expect(sanitizeReportHtml(undefined)).toBe('');
    expect(sanitizeReportHtml(123)).toBe('');
  });
});
