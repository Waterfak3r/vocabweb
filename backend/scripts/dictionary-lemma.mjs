export const DICTIONARY_IMPORTER_VERSION = "5";
export const MAX_DICTIONARY_LEMMA_LENGTH = 160;

const BASE_WORD_TOKEN = "[a-z]+(?:'[a-z]+)*(?:-[a-z]+(?:'[a-z]+)*)*";
const WORD_TOKEN = `(?:${BASE_WORD_TOKEN}|s(?:b|th|mb|mth)\\.)`;
const ELLIPSIS = "\\.\\.\\.";
const QUERY_TOKEN = `(?:(?:${ELLIPSIS})?${WORD_TOKEN}(?:${ELLIPSIS}${WORD_TOKEN})*(?:${ELLIPSIS})?|${ELLIPSIS})`;
const LEMMA_PATTERN = new RegExp(`^${QUERY_TOKEN}(?: ${QUERY_TOKEN})*$`);

export function normalizeDictionaryLemma(value) {
  return String(value)
    .normalize("NFC")
    .trim()
    .replace(/…/g, "...")
    .replace(/[‐‑]/g, "-")
    .replace(/([a-z])\s*-\s*(?=[a-z])/gi, "$1-")
    .replace(/\s+/g, " ")
    .replace(/[’ʼ]/g, "'")
    .toLowerCase();
}

export function isValidDictionaryLemma(value) {
  return value.length <= MAX_DICTIONARY_LEMMA_LENGTH && LEMMA_PATTERN.test(value);
}
