export const DICTIONARY_IMPORTER_VERSION = "2";
export const MAX_DICTIONARY_LEMMA_LENGTH = 160;

const WORD_TOKEN = "[a-z]+(?:'[a-z]+)*(?:-[a-z]+(?:'[a-z]+)*)*";
const LEMMA_PATTERN = new RegExp(`^${WORD_TOKEN}(?: ${WORD_TOKEN})*$`);

export function normalizeDictionaryLemma(value) {
  return String(value)
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[’ʼ]/g, "'")
    .toLowerCase();
}

export function isValidDictionaryLemma(value) {
  return value.length <= MAX_DICTIONARY_LEMMA_LENGTH && LEMMA_PATTERN.test(value);
}
