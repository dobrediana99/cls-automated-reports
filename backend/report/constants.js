// Board IDs and column IDs - must match existing app (App.jsx).
export const EXCHANGE_RATE = 5.1;

export const BOARD_IDS = {
  COMENZI: 2030349838,
  LEADS: 1853156722,
  CONTACTE: 1853156713,
  FURNIZORI: 1907628670,
  SOLICITARI: 1905911565,
};

export const COLS = {
  COMENZI: {
    DATA_CTR: 'deal_creation_date',
    DATA_LIVRARE: 'date_mkvyt36d',
    STATUS_CTR: 'color_mksem8fg',
    STATUS_TRANS: 'color_mkse52dk',
    PRINCIPAL: 'deal_owner',
    SECUNDAR: 'multiple_person_mkt9b24z',
    PROFIT: 'formula_mkre3gx1',
    PROFIT_PRINCIPAL: 'formula_mkt97xz',
    PROFIT_SECUNDAR: 'formula_mkt949b4',
    SURSA: 'color_mktcvtpz',
    MONEDA: 'color_mkse3amh',
    TERMEN_PLATA_CLIENT: 'numeric_mksek8d2',
    TERMEN_PLATA_FURNIZOR: 'numeric_mksev08g',
    DATA_SCADENTA_CLIENT: 'date_mkyhsbh4',
    STATUS_PLATA_CLIENT: 'color_mkv5g682',
    PROFITABILITATE: 'formula_mkxwd14p',
    CRT: 'crt_column_id',
    DEP: 'dep_column_id',
    IMPLICARE: 'implicare_column_id',
    CLIENT_FURNIZOR_PE: 'client_furnizor_pe_column_id',
    MOD_TRANSPORT: 'mod_transport_column_id',
    TIP_MARFA: 'tip_marfa_column_id',
    OCUPARE: 'ocupare_mij_transport_column_id',
    CLIENT_PE: 'color_mktcqj26',
    FURNIZ_PE: 'color_mkt9as8p',
  },
  FURNIZORI: {
    DATA: 'date4',
    PERSON: 'person',
  },
  SOLICITARI: {
    DATA: 'deal_creation_date',
    SURSA: 'color_mkpv6sj4',
    PRINCIPAL: 'deal_owner',
    SECUNDAR: 'multiple_person_mktbbfzk',
  },
  LEADS: {
    DATA: 'date__1',
    STATUS: 'lead_status',
    OWNER: 'lead_owner',
  },
  CONTACTE: {
    DATA: 'date_mkq2380r',
    OWNER: 'multiple_person_mknr9sz8',
  },
};
