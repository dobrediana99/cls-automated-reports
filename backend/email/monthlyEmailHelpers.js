/**
 * Shared helpers for monthly email renderers (department + employee).
 * Email-safe HTML only: inline styles, no external CSS/JS. All dynamic content is escaped.
 */

/**
 * Escape HTML entities to prevent injection. Replaces &, <, >, ", '.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text == null) return '';
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape text and convert newlines to HTML: \n\n -> paragraphs, \n -> <br>.
 * @param {string} text
 * @param {string} [pStyle] - style for <p> tags
 * @returns {string}
 */
export function formatTextBlock(text, pStyle = 'margin:0 0 10px 0;') {
  if (text == null) return '';
  const escaped = escapeHtml(String(text));
  const paras = escaped.split(/\n\n+/);
  const parts = paras.map((p) => {
    const withBr = p.replace(/\n/g, '<br/>');
    return `<p style="${pStyle}">${withBr}</p>`;
  });
  return parts.join('');
}

const H2_STYLE = 'font-size:18px;font-weight:bold;margin:1.2em 0 0.5em 0;color:#333;';
const H3_STYLE = 'font-size:16px;font-weight:bold;margin:1em 0 0.4em 0;color:#333;';

/**
 * @param {string} title - plain text (will be escaped)
 * @param {number} [level] - 2 or 3
 * @returns {string}
 */
export function renderSectionTitle(title, level = 2) {
  const t = escapeHtml(String(title ?? '').trim());
  if (!t) return '';
  const style = level === 3 ? H3_STYLE : H2_STYLE;
  const tag = level === 3 ? 'h3' : 'h2';
  return `<${tag} style="${style}">${t}</${tag}>`;
}

/**
 * @returns {string}
 */
export function renderHr() {
  return '<hr style="border:none;border-top:1px solid #e9e9e9;margin:18px 0;">';
}

const TABLE_STYLE = 'border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;';
const TH_STYLE = 'padding:8px 10px;border:1px solid #ddd;background:#f7f7f7;text-align:left;font-weight:bold;';
const TD_STYLE = 'padding:8px 10px;border:1px solid #ddd;';

/**
 * @param {Array<[string, string]>} rows - array of [label, value] (plain text, will be escaped)
 * @returns {string}
 */
export function renderKeyValueTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const trs = rows
    .filter((r) => r != null && r.length >= 2)
    .map(([label, value]) => `<tr><td style="${TH_STYLE}">${escapeHtml(String(label))}</td><td style="${TD_STYLE}">${escapeHtml(String(value))}</td></tr>`)
    .join('');
  return `<table style="${TABLE_STYLE}"><tbody>${trs}</tbody></table>`;
}

/**
 * KPI cards: 2-column table layout, each cell styled as a card.
 * @param {Array<{ label: string, value: string, subvalue?: string }>} cards - plain text
 * @param {number} [columns] - 2 default
 * @returns {string}
 */
export function renderKpiCards(cards, columns = 2) {
  if (!Array.isArray(cards) || cards.length === 0) return '';
  const cellStyle = 'padding:12px;border:1px solid #e0e0e0;background:#f7f7f7;vertical-align:top;';
  const valueStyle = 'font-weight:bold;font-size:15px;';
  const subStyle = 'font-size:12px;color:#555;margin-top:4px;';
  let html = `<table style="${TABLE_STYLE}"><tbody><tr>`;
  cards.forEach((card, i) => {
    if (i > 0 && i % columns === 0) html += '</tr><tr>';
    const label = escapeHtml(String(card?.label ?? ''));
    const value = escapeHtml(String(card?.value ?? ''));
    const sub = card?.subvalue != null ? `<div style="${subStyle}">${escapeHtml(String(card.subvalue))}</div>` : '';
    html += `<td style="${cellStyle}"><div style="font-size:12px;color:#555;">${label}</div><div style="${valueStyle}">${value}</div>${sub}</td>`;
  });
  const remainder = columns - (cards.length % columns);
  if (remainder > 0 && remainder < columns) {
    for (let j = 0; j < remainder; j++) html += '<td style="' + cellStyle + '">&nbsp;</td>';
  }
  html += '</tr></tbody></table>';
  return html;
}

/**
 * Parse a markdown-style table string (lines with pipes) into HTML table.
 * First line = header row; line with only |-| or similar = separator (skip); rest = body rows.
 * @param {string} markdownString
 * @returns {string} HTML table or empty string; on parse failure returns <pre> with escaped content
 */
export function parseMarkdownTableToHtml(markdownString) {
  if (markdownString == null || typeof markdownString !== 'string') return '';
  const trimmed = markdownString.trim();
  if (!trimmed) return '';

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return '';

  const pipeLines = lines.filter((l) => /\|/.test(l));
  if (pipeLines.length === 0) {
    return `<pre style="font-family:Arial,sans-serif;font-size:13px;white-space:pre-wrap;margin:0 0 10px 0;">${escapeHtml(trimmed)}</pre>`;
  }

  const separatorIndex = pipeLines.findIndex((l) => /^\s*[\|\s\-:]+\s*$/.test(l.trim()));
  const headerLine = pipeLines[0];
  const bodyLines = separatorIndex >= 0 ? pipeLines.slice(separatorIndex + 1) : pipeLines.slice(1);

  const parseRow = (line) => {
    const parts = line.split('|').map((c) => c.trim());
    if (parts.length > 2 && parts[0] === '' && parts[parts.length - 1] === '') return parts.slice(1, -1);
    return parts;
  };

  const headers = parseRow(headerLine);
  if (headers.length === 0) {
    return `<pre style="font-family:Arial,sans-serif;font-size:13px;white-space:pre-wrap;margin:0 0 10px 0;">${escapeHtml(trimmed)}</pre>`;
  }

  const thead = '<thead><tr>' + headers.map((h) => `<th style="${TH_STYLE}">${escapeHtml(h)}</th>`).join('') + '</tr></thead>';
  const tbodyRows = bodyLines.map((line) => {
    const cells = parseRow(line);
    const padded = headers.length > cells.length ? [...cells, ...Array(headers.length - cells.length).fill('')] : cells.slice(0, headers.length);
    return '<tr>' + padded.map((c) => `<td style="${TD_STYLE}">${escapeHtml(c)}</td>`).join('') + '</tr>';
  }).join('');
  const tbody = '<tbody>' + tbodyRows + '</tbody>';
  return `<table style="${TABLE_STYLE}">${thead}${tbody}</table>`;
}
