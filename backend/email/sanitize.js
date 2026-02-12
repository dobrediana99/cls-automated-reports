/**
 * Sanitize LLM-generated HTML before inserting into emails.
 * Allowlist of tags/attributes; strips script, iframe, img, form, etc.
 * Forces rel="noopener noreferrer" on links with target="_blank".
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u',
  'a', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'code', 'pre', 'h1', 'h2', 'h3', 'h4',
];

const ALLOWED_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  span: ['class', 'style'],
  div: ['class', 'style'],
  p: ['class', 'style'],
  ul: ['class', 'style'],
  ol: ['class', 'style'],
  li: ['class', 'style'],
  table: ['class', 'style'],
  thead: ['class', 'style'],
  tbody: ['class', 'style'],
  tr: ['class', 'style'],
  th: ['class', 'style', 'colspan', 'rowspan'],
  td: ['class', 'style', 'colspan', 'rowspan'],
  h1: ['class', 'style'],
  h2: ['class', 'style'],
  h3: ['class', 'style'],
  h4: ['class', 'style'],
  code: ['class'],
  pre: ['class', 'style'],
};

/**
 * Sanitize HTML string for use in report email sections.
 * Removes script, iframe, img, style tag, form, input, button, video, audio, svg.
 * Ensures links with target="_blank" get rel="noopener noreferrer".
 * @param {string} html - Raw HTML from LLM
 * @returns {string} Sanitized HTML
 */
export function sanitizeReportHtml(html) {
  if (html == null || typeof html !== 'string') return '';
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'ftp', 'mailto'],
    transformTags: {
      a: (tagName, attrs) => {
        const next = { tagName, attrs: { ...attrs } };
        if (attrs.target === '_blank' || attrs.target === '"_blank"') {
          next.attrs.rel = 'noopener noreferrer';
        }
        return next;
      },
    },
  });
}
