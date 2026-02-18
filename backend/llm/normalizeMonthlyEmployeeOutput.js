/**
 * Best-effort normalization of monthly employee LLM output before AJV validation.
 * Fixes common LLM mistakes: empty/whitespace strings in arrays, non-string fields,
 * alternative keys and extra properties in actiuni_specifice_per_rol.
 * Does not modify the JSON schema.
 */

const DEFAULT_CONTINUT = ['Date indisponibile'];
const DEFAULT_STRING = 'N/A';
const DEFAULT_ACTIUNI = ['De stabilit'];

/** Synonyms for actiuni_specifice_per_rol keys (first match wins). */
const FREIGHT_FORWARDER_KEYS = [
  'freight_forwarder',
  'forwarder',
  'freight',
  'ff',
];
const SALES_FREIGHT_AGENT_KEYS = [
  'sales_freight_agent',
  'sales_agent',
  'sales',
  'sfa',
];

/**
 * Ensure value is a string: if array → join with \n; if object/other → JSON.stringify; fallback DEFAULT_STRING.
 * @param {unknown} value
 * @returns {string}
 */
function toNonEmptyString(value) {
  if (value == null) return DEFAULT_STRING;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : DEFAULT_STRING;
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : DEFAULT_STRING;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value).trim();
  return s.length > 0 ? s : DEFAULT_STRING;
}

/**
 * Normalize an array to non-empty trimmed strings; if empty after filter, return single default item.
 * @param {unknown} arr
 * @param {string} defaultItem
 * @returns {string[]}
 */
function toNonEmptyStringArray(arr, defaultItem = DEFAULT_ACTIUNI[0]) {
  if (!Array.isArray(arr)) return [defaultItem];
  const out = arr
    .map((v) => (typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''))
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : [defaultItem];
}

/**
 * Pick first existing key from object from a list of candidate keys (case-sensitive).
 * @param {object} obj
 * @param {string[]} keys
 * @returns {unknown}
 */
function pickFirst(obj, keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

/**
 * Normalize monthly employee LLM output for schema validation (best effort).
 * Mutates and returns the same object reference.
 *
 * - sectiunea_1_tabel_date_performanta.continut: trim items, drop empty, default ["Date indisponibile"]
 * - sectiunea_3_concluzii.ce_merge_bine / ce_nu_merge_si_necesita_interventie_urgenta: ensure string (array→join \n, else stringify/fallback "N/A")
 * - sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol: map synonyms to freight_forwarder & sales_freight_agent, strip other keys, ensure both arrays min 1 non-empty string
 *
 * @param {object} o - Parsed JSON output (will be mutated)
 * @returns {object} The same object (normalized in place)
 */
export function normalizeMonthlyEmployeeOutput(o) {
  if (!o || typeof o !== 'object') return o;

  // --- sectiunea_1_tabel_date_performanta.continut ---
  const s1 = o.sectiunea_1_tabel_date_performanta;
  if (s1 && typeof s1 === 'object' && Array.isArray(s1.continut)) {
    const trimmed = s1.continut
      .map((v) => (typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''))
      .filter((s) => s.length > 0);
    s1.continut = trimmed.length > 0 ? trimmed : DEFAULT_CONTINUT.slice();
  } else if (s1 && typeof s1 === 'object' && s1.continut !== undefined) {
    s1.continut = DEFAULT_CONTINUT.slice();
  }

  // --- sectiunea_3_concluzii.ce_merge_bine & ce_nu_merge_si_necesita_interventie_urgenta ---
  const s3 = o.sectiunea_3_concluzii;
  if (s3 && typeof s3 === 'object') {
    if (typeof s3.ce_merge_bine !== 'string' || s3.ce_merge_bine.trim() === '') {
      s3.ce_merge_bine = toNonEmptyString(s3.ce_merge_bine);
    } else {
      s3.ce_merge_bine = s3.ce_merge_bine.trim();
    }
    if (
      typeof s3.ce_nu_merge_si_necesita_interventie_urgenta !== 'string' ||
      s3.ce_nu_merge_si_necesita_interventie_urgenta.trim() === ''
    ) {
      s3.ce_nu_merge_si_necesita_interventie_urgenta = toNonEmptyString(
        s3.ce_nu_merge_si_necesita_interventie_urgenta
      );
    } else {
      s3.ce_nu_merge_si_necesita_interventie_urgenta =
        s3.ce_nu_merge_si_necesita_interventie_urgenta.trim();
    }
  }

  // --- sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol ---
  const s4 = o.sectiunea_4_actiuni_prioritare;
  if (s4 && typeof s4 === 'object' && s4.actiuni_specifice_per_rol != null) {
    const raw = s4.actiuni_specifice_per_rol;
    const obj = typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const ff = pickFirst(obj, FREIGHT_FORWARDER_KEYS);
    const sfa = pickFirst(obj, SALES_FREIGHT_AGENT_KEYS);
    s4.actiuni_specifice_per_rol = {
      freight_forwarder: toNonEmptyStringArray(ff),
      sales_freight_agent: toNonEmptyStringArray(sfa),
    };
  }

  return o;
}
