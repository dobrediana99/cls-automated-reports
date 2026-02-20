/**
 * Semantic adapter layer: maps validated LLM output to a compact "semantic payload"
 * used by email renderers. Backend controls 100% of structure (titles, order, tables, styling);
 * LLM provides only semantic content (text, lists). Layout/titles/table structure from LLM are ignored.
 */

const DEFAULT_STRING = 'N/A';
const DEFAULT_ACTIUNI = ['De stabilit'];
const DEFAULT_SAPTAMANA_1 = 'Săptămâna 1: de stabilit.';
const DEFAULT_SAPTAMANA_2_4 = 'Săptămânile 2–4: de stabilit.';
const DEFAULT_RAPORT_URMATOR = 'Raportul următor va fi disponibil conform programului.';
const DEFAULT_MESAJ_SUB_80 = 'Vom reveni cu un check-in intermediar pentru îmbunătățirea performanței.';
const DEFAULT_MESAJ_PESTE_80 = 'Continuă la fel în luna următoare.';
const DEFAULT_SEMNATURA = { nume: 'Echipa Management', functie: 'Management', companie: 'Crystal Logistics Services' };

function toStr(v, fallback = '') {
  if (v == null) return fallback;
  const s = typeof v === 'string' ? v.trim() : String(v).trim();
  return s.length > 0 ? s : fallback;
}

function toStrArray(v, defaultItem = DEFAULT_ACTIUNI[0]) {
  if (!Array.isArray(v)) return [defaultItem];
  const out = v
    .map((x) => (typeof x === 'string' ? x.trim() : x != null ? String(x).trim() : ''))
    .filter(Boolean);
  return out.length > 0 ? out : [defaultItem];
}

/**
 * Extract semantic payload for employee email. Ignores layout/titles/tables from LLM.
 * Returns only: greeting, intro, interpretare, concluzii, actiuni (flat list), plan, checkIn?, incheiere.
 * @param {object} llmSections - Validated employee LLM output (antet, sectiunea_2..6, incheiere)
 * @param {{ name?: string }} [person] - Optional, for greeting fallback
 * @returns {object} Semantic payload for renderer
 */
export function employeeToSemanticPayload(llmSections, person = null) {
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('employeeToSemanticPayload requires validated llmSections object.');
  }

  const antet = llmSections.antet ?? {};
  const s2 = llmSections.sectiunea_2_interpretare_date ?? {};
  const s3 = llmSections.sectiunea_3_concluzii ?? {};
  const s4 = llmSections.sectiunea_4_actiuni_prioritare ?? {};
  const s5 = llmSections.sectiunea_5_plan_saptamanal ?? {};
  const s6 = llmSections.sectiunea_6_check_in_intermediar;
  const inc = llmSections.incheiere ?? {};

  const rol = s4?.actiuni_specifice_per_rol;
  const ff = toStrArray(rol?.freight_forwarder);
  const sfa = toStrArray(rol?.sales_freight_agent);
  const actiuni = [...ff, ...sfa];

  const fmt = s5?.format ?? {};
  const semn = inc.semnatura && typeof inc.semnatura === 'object' ? inc.semnatura : {};

  return {
    greeting: toStr(antet.greeting),
    introMessage: toStr(antet.intro_message),
    interpretare: {
      stil: toStr(s2.stil),
      include: toStrArray(s2.include, '–'),
    },
    concluzii: {
      ceMergeBine: toStr(s3.ce_merge_bine, '–'),
      ceNuMerge: toStr(s3.ce_nu_merge_si_necesita_interventie_urgenta, '–'),
      focusLunaUrmatoare: toStr(s3.focus_luna_urmatoare, '–'),
    },
    actiuni: actiuni.length > 0 ? actiuni : DEFAULT_ACTIUNI,
    plan: {
      saptamana_1: toStr(fmt.saptamana_1, DEFAULT_SAPTAMANA_1),
      saptamana_2_4: toStr(fmt.saptamana_2_4, DEFAULT_SAPTAMANA_2_4),
    },
    checkIn:
      s6 != null && typeof s6 === 'object'
        ? { format: toStr(s6.format), regula: toStr(s6.regula) }
        : null,
    incheiere: {
      raportUrmator: toStr(inc.raport_urmator, DEFAULT_RAPORT_URMATOR),
      mesajSub80: toStr(inc.mesaj_sub_80, DEFAULT_MESAJ_SUB_80),
      mesajPeste80: toStr(inc.mesaj_peste_80, DEFAULT_MESAJ_PESTE_80),
      semnatura: {
        nume: toStr(semn.nume, DEFAULT_SEMNATURA.nume),
        functie: toStr(semn.functie, DEFAULT_SEMNATURA.functie),
        companie: toStr(semn.companie, DEFAULT_SEMNATURA.companie),
      },
    },
  };
}

/**
 * Extract semantic payload for department email. Ignores sectiunea_1 (Rezumat Executiv is backend-built).
 * Returns only narrative/content fields for s2, s3, s4, s5, incheiere. Section titles are backend-controlled.
 * @param {object} llmSections - Validated department LLM output
 * @returns {object} Semantic payload for renderer
 */
export function departmentToSemanticPayload(llmSections) {
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('departmentToSemanticPayload requires validated llmSections object.');
  }

  const antet = llmSections.antet ?? {};
  const s2 = llmSections.sectiunea_2_analiza_vanzari ?? {};
  const s3 = llmSections.sectiunea_3_analiza_operational ?? {};
  const s4 = llmSections.sectiunea_4_comparatie_departamente ?? {};
  const s5 = llmSections.sectiunea_5_recomandari_management ?? {};
  const inc = llmSections.incheiere ?? {};

  return {
    intro: toStr(antet.introducere),
    analizaVanzari: {
      performantaVsIstoric: s2.performantaVsIstoric && typeof s2.performantaVsIstoric === 'object' ? s2.performantaVsIstoric : {},
      targetDepartamental: s2.targetDepartamental && typeof s2.targetDepartamental === 'object' ? s2.targetDepartamental : {},
      metriciMediiPerAngajat: s2.metriciMediiPerAngajat && typeof s2.metriciMediiPerAngajat === 'object' ? s2.metriciMediiPerAngajat : {},
      tabelAngajati: typeof s2.tabelAngajati === 'string' ? s2.tabelAngajati : '',
      problemeIdentificateAngajati: Array.isArray(s2.problemeIdentificateAngajati) ? s2.problemeIdentificateAngajati : [],
      highPerformers: Array.isArray(s2.highPerformers) ? s2.highPerformers : [],
      lowPerformers: Array.isArray(s2.lowPerformers) ? s2.lowPerformers : [],
      problemeSistemice: Array.isArray(s2.problemeSistemice) ? s2.problemeSistemice : [],
    },
    analizaOperational: {
      performantaVsIstoric: s3.performantaVsIstoric && typeof s3.performantaVsIstoric === 'object' ? s3.performantaVsIstoric : {},
      targetDepartamental: s3.targetDepartamental && typeof s3.targetDepartamental === 'object' ? s3.targetDepartamental : {},
      metriciMediiPerAngajat: s3.metriciMediiPerAngajat && typeof s3.metriciMediiPerAngajat === 'object' ? s3.metriciMediiPerAngajat : {},
      tabelAngajati: typeof s3.tabelAngajati === 'string' ? s3.tabelAngajati : '',
      problemeIdentificateAngajati: Array.isArray(s3.problemeIdentificateAngajati) ? s3.problemeIdentificateAngajati : [],
      highPerformers: Array.isArray(s3.highPerformers) ? s3.highPerformers : [],
      lowPerformers: Array.isArray(s3.lowPerformers) ? s3.lowPerformers : [],
      problemeSistemice: Array.isArray(s3.problemeSistemice) ? s3.problemeSistemice : [],
    },
    comparatie: {
      tabelComparativ: s4.tabelComparativ && typeof s4.tabelComparativ === 'object' ? s4.tabelComparativ : {},
      observatii: Array.isArray(s4.observatii) ? s4.observatii : [],
    },
    recomandari: {
      oneToOneLowPerformers: Array.isArray(s5.oneToOneLowPerformers) ? s5.oneToOneLowPerformers : [],
      trainingNecesare: Array.isArray(s5.trainingNecesare) ? s5.trainingNecesare : [],
      urmarireSaptamanala: Array.isArray(s5.urmarireSaptamanala) ? s5.urmarireSaptamanala : [],
      setareObiectiveSpecifice: Array.isArray(s5.setareObiectiveSpecifice) ? s5.setareObiectiveSpecifice : [],
      mutariRolOptional: Array.isArray(s5.mutariRolOptional) ? s5.mutariRolOptional : [],
      problemeSistemiceProces: Array.isArray(s5.problemeSistemiceProces) ? s5.problemeSistemiceProces : [],
    },
    incheiere: {
      urmatorulRaport: toStr(inc.urmatorulRaport),
      semnatura: inc.semnatura && typeof inc.semnatura === 'object' ? inc.semnatura : {},
    },
  };
}
