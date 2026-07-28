import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DICTIONARY_IMPORTER_VERSION,
  isValidDictionaryLemma,
  normalizeDictionaryLemma,
} from "../scripts/dictionary-lemma.mjs";

test("dictionary importer accepts normalized words and multi-word lemmas", () => {
  assert.equal(DICTIONARY_IMPORTER_VERSION, "2");
  assert.equal(normalizeDictionaryLemma("  Depository   Financial Institution  "), "depository financial institution");
  assert.equal(normalizeDictionaryLemma("Rock’n’Roll"), "rock'n'roll");
  assert.equal(isValidDictionaryLemma("a lot of"), true);
  assert.equal(isValidDictionaryLemma("depository financial institution"), true);
  assert.equal(isValidDictionaryLemma("well-known"), true);
});

test("dictionary importer rejects invalid and overlong lemmas", () => {
  assert.equal(isValidDictionaryLemma("word2"), false);
  assert.equal(isValidDictionaryLemma("hello/world"), false);
  assert.equal(isValidDictionaryLemma("a".repeat(161)), false);
});
