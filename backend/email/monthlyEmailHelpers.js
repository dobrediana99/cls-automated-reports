/**
 * Shared helpers for monthly email renderers (department + employee).
 * Email-safe HTML only: inline styles, no external CSS/JS. All dynamic content is escaped.
 */

import {
  round2,
  totalProfitEur,
  calcTargetAchievementPct,
  calcCallsPerWorkingDay,
  calcProspectingConversionPct,
} from '../utils/kpiCalc.js';

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

/** Patterns for numeric-like cells (right-align in performance tables). */
const NUM_LIKE = /^[-+]?\d+(?:[.,]\d+)?\s*$/;
const MONEY_LIKE = /EUR\s*$/i;
const PCT_LIKE = /%\s*$/;
const DAYS_LIKE = /\bzile\b/i;

function looksNumericOrUnit(text) {
  if (text == null || typeof text !== 'string') return false;
  const t = text.trim();
  return NUM_LIKE.test(t) || MONEY_LIKE.test(t) || PCT_LIKE.test(t) || DAYS_LIKE.test(t);
}

/**
 * Check if a line is a table row: contains "|" and at least 2 pipes (3+ cells).
 * @param {string} line
 * @returns {boolean}
 */
function isTableLine(line) {
  if (line == null || typeof line !== 'string') return false;
  const pipes = (line.match(/\|/g) || []).length;
  return pipes >= 2;
}

/**
 * Parse lines into blocks: consecutive table lines → one table block; other lines → text block.
 * @param {string[]} lines
 * @returns {Array<{ type: 'table' | 'text', lines: string[] }>}
 */
function groupPerformanceBlocks(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  const blocks = [];
  let current = { type: null, lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    const isTable = isTableLine(raw);

    if (trimmed === '') {
      if (current.lines.length > 0) {
        blocks.push({ type: current.type, lines: current.lines });
        current = { type: null, lines: [] };
      }
      continue;
    }

    if (isTable) {
      if (current.type !== 'table') {
        if (current.lines.length > 0) {
          blocks.push({ type: current.type, lines: current.lines });
          current = { type: null, lines: [] };
        }
        current.type = 'table';
      }
      current.lines.push(raw);
    } else {
      if (current.type !== 'text') {
        if (current.lines.length > 0) {
          blocks.push({ type: current.type, lines: current.lines });
          current = { type: null, lines: [] };
        }
        current.type = 'text';
      }
      current.lines.push(raw);
    }
  }
  if (current.lines.length > 0) {
    blocks.push({ type: current.type, lines: current.lines });
  }
  return blocks;
}

const PERF_TABLE_STYLE = 'border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;';
const PERF_TH_STYLE = 'background:#f3f4f6;border:1px solid #e5e7eb;padding:8px;text-align:left;font-weight:700;white-space:nowrap;';
const PERF_TD_BASE = 'border:1px solid #e5e7eb;padding:8px;vertical-align:top;';

/**
 * Render one table block as HTML <table> with header, zebra rows, numeric right-align.
 * @param {string[]} blockLines
 * @returns {string}
 */
function renderPerformanceTableBlock(blockLines) {
  if (!blockLines || blockLines.length === 0) return '';
  const rows = blockLines.map((line) => {
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    return cells;
  });
  if (rows.length === 0) return '';
  const maxCols = Math.max(...rows.map((r) => r.length));
  const normalize = (cells) => {
    const pad = [...cells];
    while (pad.length < maxCols) pad.push('');
    return pad.slice(0, maxCols);
  };

  const headerCells = normalize(rows[0]);
  const thead = '<thead><tr>' + headerCells.map((c) => `<th style="${PERF_TH_STYLE}">${escapeHtml(c)}</th>`).join('') + '</tr></thead>';

  const bodyRows = rows.slice(1).map((cells, rowIndex) => {
    const padded = normalize(cells);
    const zebra = rowIndex % 2 === 0 ? '#ffffff' : '#fafafa';
    const trStyle = `background:${zebra};`;
    const tds = padded.map((cell, colIndex) => {
      const isFirstCol = colIndex === 0;
      let cellStyle = PERF_TD_BASE;
      if (isFirstCol) {
        cellStyle += ';text-align:left;font-weight:600;';
      } else if (looksNumericOrUnit(cell)) {
        cellStyle += ';text-align:right;white-space:nowrap;';
      }
      return `<td style="${cellStyle}">${escapeHtml(cell)}</td>`;
    });
    return `<tr style="${trStyle}">${tds.join('')}</tr>`;
  });
  const tbody = '<tbody>' + bodyRows.join('') + '</tbody>';
  const table = `<table style="${PERF_TABLE_STYLE}">${thead}${tbody}</table>`;
  return `<div style="margin:12px 0;overflow-x:auto;">${table}</div>`;
}

/**
 * Render one text block: titlu-like (ALL CAPS / INDICATORI) as bold p, rest as list or p.
 * @param {string[]} blockLines
 * @returns {string}
 */
function renderPerformanceTextBlock(blockLines) {
  if (!blockLines || blockLines.length === 0) return '';
  const SECTION_STYLE = 'margin:1em 0 0 0;';
  const parts = [];
  for (const line of blockLines) {
    const t = typeof line === 'string' ? line.trim() : String(line).trim();
    if (!t) continue;
    const escaped = escapeHtml(t);
    const isTitle = /^[A-Z\s\-–—:]+$/.test(t) || /\bINDICATORI\b/i.test(t) || /\bCOMENZI\b/i.test(t);
    if (isTitle) {
      parts.push(`<p style="margin:12px 0 6px 0;font-weight:700;">${escaped}</p>`);
    } else {
      parts.push(`<p style="margin:4px 0;">${escaped}</p>`);
    }
  }
  if (parts.length === 0) return '';
  return `<div style="${SECTION_STYLE}">${parts.join('')}</div>`;
}

/**
 * Render section 1 "Date de performanță" content: pipe-separated blocks → real <table>; rest → text/paragraphs.
 * @param {string[]} lines - s1.continut
 * @returns {string} HTML fragment (no section title)
 */
export function renderEmployeePerformanceContent(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  const blocks = groupPerformanceBlocks(lines);
  const html = blocks.map((block) => {
    if (block.type === 'table') return renderPerformanceTableBlock(block.lines);
    return renderPerformanceTextBlock(block.lines);
  }).join('');
  return html || '';
}

const DASH = '–';

function fmtEur(val) {
  if (val == null || typeof val !== 'number' || !Number.isFinite(val)) return DASH;
  const r = round2(val);
  return r != null ? `${r} EUR` : DASH;
}
function fmtPct(val) {
  if (val == null || typeof val !== 'number' || !Number.isFinite(val)) return DASH;
  const r = round2(val);
  return r != null ? `${r}%` : DASH;
}
function fmtNum(val) {
  if (val == null || (typeof val !== 'number') || !Number.isFinite(val)) return DASH;
  const r = round2(val);
  return r != null ? String(r) : DASH;
}
function fmtInt(val) {
  if (val == null || typeof val !== 'number' || !Number.isFinite(val)) return DASH;
  return String(Math.round(val));
}
function deltaPct(cur, prev) {
  if (prev == null || typeof prev !== 'number' || typeof cur !== 'number' || !Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return DASH;
  const r = round2(((cur - prev) / prev) * 100);
  return r != null ? (r >= 0 ? `+${r}%` : `${r}%`) : DASH;
}

/**
 * Build deterministic "Date de performanță" table from numeric data. Same layout for all employees.
 * Columns: Indicator | Luna curentă | Luna anterioară | Δ%
 * Uses data3Months.current, data3Months.prev only (no department average column).
 * @param {{ current?: object, prev?: object }} data3Months
 * @param {{ current?: object }} deptAverages3Months - kept for API compatibility, not used in output
 * @param {number} workingDaysInPeriod
 * @returns {string} HTML table fragment (no section title)
 */
export function buildDeterministicPerformanceTable(data3Months, deptAverages3Months, workingDaysInPeriod) {
  const cur = data3Months?.current;
  const prev = data3Months?.prev;
  const wd = workingDaysInPeriod > 0 ? workingDaysInPeriod : null;
  const n = (row, key) => {
    const val = Number(row?.[key]);
    return Number.isFinite(val) ? val : 0;
  };
  const avgFromSums = (row, sumKey, countKey) => {
    const count = n(row, countKey);
    if (count <= 0) return null;
    return n(row, sumKey) / count;
  };
  const convWebPct = (row) => {
    const solicitari = n(row, 'solicitariCount');
    const website = n(row, 'websiteCount');
    if (solicitari > 0) return (website / solicitari) * 100;
    return website > 0 ? 100 : null;
  };

  const curProfit = round2(totalProfitEur(cur));
  const prevProfit = round2(totalProfitEur(prev));
  const curTargetPct = calcTargetAchievementPct(cur);
  const prevTargetPct = calcTargetAchievementPct(prev);
  const curApeluri = wd != null ? calcCallsPerWorkingDay(cur?.callsCount, wd) : null;
  const prevApeluri = wd != null ? calcCallsPerWorkingDay(prev?.callsCount, wd) : null;
  const curRataConv = calcProspectingConversionPct(cur?.contactat, cur?.calificat);
  const prevRataConv = calcProspectingConversionPct(prev?.contactat, prev?.calificat);
  const curLivrPrincipalCount = n(cur, 'livr_principalCount');
  const prevLivrPrincipalCount = n(prev, 'livr_principalCount');
  const curLivrPrincipalProfit = n(cur, 'livr_principalProfitEur');
  const prevLivrPrincipalProfit = n(prev, 'livr_principalProfitEur');
  const curLivrSecondaryCount = n(cur, 'livr_secondaryCount');
  const prevLivrSecondaryCount = n(prev, 'livr_secondaryCount');
  const curLivrSecondaryProfit = n(cur, 'livr_secondaryProfitEur');
  const prevLivrSecondaryProfit = n(prev, 'livr_secondaryProfitEur');
  const curTotalLivrCount = curLivrPrincipalCount + curLivrSecondaryCount;
  const prevTotalLivrCount = prevLivrPrincipalCount + prevLivrSecondaryCount;
  const curTotalLivrProfit = curLivrPrincipalProfit + curLivrSecondaryProfit;
  const prevTotalLivrProfit = prevLivrPrincipalProfit + prevLivrSecondaryProfit;
  const curProfitability = avgFromSums(cur, 'sumProfitability', 'countProfitability');
  const prevProfitability = avgFromSums(prev, 'sumProfitability', 'countProfitability');
  const curWebCount = n(cur, 'websiteCount');
  const prevWebCount = n(prev, 'websiteCount');
  const curWebProfit = n(cur, 'websiteProfit');
  const prevWebProfit = n(prev, 'websiteProfit');
  const curWebCountSec = n(cur, 'websiteCountSec');
  const prevWebCountSec = n(prev, 'websiteCountSec');
  const curWebProfitSec = n(cur, 'websiteProfitSec');
  const prevWebProfitSec = n(prev, 'websiteProfitSec');
  const curBurse = n(cur, 'burseCount');
  const prevBurse = n(prev, 'burseCount');
  const curSolicitari = n(cur, 'solicitariCount');
  const prevSolicitari = n(prev, 'solicitariCount');
  const curConvWeb = convWebPct(cur);
  const prevConvWeb = convWebPct(prev);
  const curTermenClient = avgFromSums(cur, 'sumClientTerms', 'countClientTerms');
  const prevTermenClient = avgFromSums(prev, 'sumClientTerms', 'countClientTerms');
  const curTermenFurn = avgFromSums(cur, 'sumSupplierTerms', 'countSupplierTerms');
  const prevTermenFurn = avgFromSums(prev, 'sumSupplierTerms', 'countSupplierTerms');
  const curOverdue = n(cur, 'overdueInvoicesCount');
  const prevOverdue = n(prev, 'overdueInvoicesCount');
  const curSup30 = n(cur, 'supplierTermsUnder30');
  const prevSup30 = n(prev, 'supplierTermsUnder30');
  const curSupGe30 = n(cur, 'supplierTermsOver30');
  const prevSupGe30 = n(prev, 'supplierTermsOver30');
  const curContactat = n(cur, 'contactat');
  const prevContactat = n(prev, 'contactat');
  const curCalificat = n(cur, 'calificat');
  const prevCalificat = n(prev, 'calificat');
  const curCallsCount = n(cur, 'callsCount');
  const prevCallsCount = n(prev, 'callsCount');

  const rows = [
    ['Profit total', fmtEur(curProfit), fmtEur(prevProfit), deltaPct(curProfit, prevProfit)],
    ['Realizare target', fmtPct(curTargetPct), fmtPct(prevTargetPct), deltaPct(curTargetPct, prevTargetPct)],
    ['Apeluri medii/zi', fmtNum(curApeluri), fmtNum(prevApeluri), deltaPct(curApeluri, prevApeluri)],
    ['Clienți contactați telefonic', fmtInt(curContactat), fmtInt(prevContactat), deltaPct(curContactat, prevContactat)],
    ['Clienți calificați', fmtInt(curCalificat), fmtInt(prevCalificat), deltaPct(curCalificat, prevCalificat)],
    ['Rata conversie clienți (%)', fmtPct(curRataConv), fmtPct(prevRataConv), deltaPct(curRataConv, prevRataConv)],
    ['Apeluri', fmtInt(curCallsCount), fmtInt(prevCallsCount), deltaPct(curCallsCount, prevCallsCount)],
    ['Curse livrate principal', fmtInt(curLivrPrincipalCount), fmtInt(prevLivrPrincipalCount), deltaPct(curLivrPrincipalCount, prevLivrPrincipalCount)],
    ['Profit curse livrate principal (EUR)', fmtEur(curLivrPrincipalProfit), fmtEur(prevLivrPrincipalProfit), deltaPct(curLivrPrincipalProfit, prevLivrPrincipalProfit)],
    ['Curse livrate secundar', fmtInt(curLivrSecondaryCount), fmtInt(prevLivrSecondaryCount), deltaPct(curLivrSecondaryCount, prevLivrSecondaryCount)],
    ['Profit curse livrate secundar (EUR)', fmtEur(curLivrSecondaryProfit), fmtEur(prevLivrSecondaryProfit), deltaPct(curLivrSecondaryProfit, prevLivrSecondaryProfit)],
    ['Total curse livrate', fmtInt(curTotalLivrCount), fmtInt(prevTotalLivrCount), deltaPct(curTotalLivrCount, prevTotalLivrCount)],
    ['Total profit curse livrate (EUR)', fmtEur(curTotalLivrProfit), fmtEur(prevTotalLivrProfit), deltaPct(curTotalLivrProfit, prevTotalLivrProfit)],
    ['Profitabilitate (%)', fmtPct(curProfitability), fmtPct(prevProfitability), deltaPct(curProfitability, prevProfitability)],
    ['Curse web principal', fmtInt(curWebCount), fmtInt(prevWebCount), deltaPct(curWebCount, prevWebCount)],
    ['Profit web principal (EUR)', fmtEur(curWebProfit), fmtEur(prevWebProfit), deltaPct(curWebProfit, prevWebProfit)],
    ['Curse web secundar', fmtInt(curWebCountSec), fmtInt(prevWebCountSec), deltaPct(curWebCountSec, prevWebCountSec)],
    ['Profit web secundar (EUR)', fmtEur(curWebProfitSec), fmtEur(prevWebProfitSec), deltaPct(curWebProfitSec, prevWebProfitSec)],
    ['Curse burse', fmtInt(curBurse), fmtInt(prevBurse), deltaPct(curBurse, prevBurse)],
    ['Solicitări web', fmtInt(curSolicitari), fmtInt(prevSolicitari), deltaPct(curSolicitari, prevSolicitari)],
    ['Conversie web (%)', fmtPct(curConvWeb), fmtPct(prevConvWeb), deltaPct(curConvWeb, prevConvWeb)],
    ['Termen mediu client (zile)', fmtNum(curTermenClient), fmtNum(prevTermenClient), deltaPct(curTermenClient, prevTermenClient)],
    ['Termen mediu furnizor (zile)', fmtNum(curTermenFurn), fmtNum(prevTermenFurn), deltaPct(curTermenFurn, prevTermenFurn)],
    ['Întârzieri > 15 zile', fmtInt(curOverdue), fmtInt(prevOverdue), deltaPct(curOverdue, prevOverdue)],
    ['Furnizori < 30 zile', fmtInt(curSup30), fmtInt(prevSup30), deltaPct(curSup30, prevSup30)],
    ['Furnizori >= 30 zile', fmtInt(curSupGe30), fmtInt(prevSupGe30), deltaPct(curSupGe30, prevSupGe30)],
  ];

  const headers = ['Indicator', 'Luna curentă', 'Luna anterioară', 'Δ%'];
  const thead = '<thead><tr>' + headers.map((h) => `<th style="${PERF_TH_STYLE}">${escapeHtml(h)}</th>`).join('') + '</tr></thead>';
  const tbody =
    '<tbody>' +
    rows
      .map((cells, rowIndex) => {
        const zebra = rowIndex % 2 === 0 ? '#ffffff' : '#fafafa';
        const tds = cells.map((cell, colIndex) => {
          let cellStyle = PERF_TD_BASE;
          if (colIndex === 0) cellStyle += ';text-align:left;font-weight:600;';
          else cellStyle += ';text-align:right;white-space:nowrap;';
          return `<td style="${cellStyle}">${escapeHtml(cell)}</td>`;
        });
        return `<tr style="background:${zebra}">${tds.join('')}</tr>`;
      })
      .join('') +
    '</tbody>';
  return `<div style="margin:12px 0;overflow-x:auto;"><table style="${PERF_TABLE_STYLE}">${thead}${tbody}</table></div>`;
}
