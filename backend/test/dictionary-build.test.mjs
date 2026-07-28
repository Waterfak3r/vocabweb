import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DICTIONARY_IMPORTER_VERSION,
  isValidDictionaryLemma,
  normalizeDictionaryLemma,
} from "../scripts/dictionary-lemma.mjs";

test("dictionary importer accepts normalized words and multi-word lemmas", () => {
  assert.equal(DICTIONARY_IMPORTER_VERSION, "5");
  assert.equal(normalizeDictionaryLemma("  Depository   Financial Institution  "), "depository financial institution");
  assert.equal(normalizeDictionaryLemma("Rock’n’Roll"), "rock'n'roll");
  assert.equal(isValidDictionaryLemma("a lot of"), true);
  assert.equal(isValidDictionaryLemma("depository financial institution"), true);
  assert.equal(isValidDictionaryLemma("well-known"), true);
  assert.equal(isValidDictionaryLemma("agree with sb."), true);
  assert.equal(isValidDictionaryLemma("be devoted to sth."), true);
  assert.equal(isValidDictionaryLemma("connect...with..."), true);
  assert.equal(normalizeDictionaryLemma("well ‑ known"), "well-known");
});

test("dictionary importer rejects invalid and overlong lemmas", () => {
  assert.equal(isValidDictionaryLemma("word2"), false);
  assert.equal(isValidDictionaryLemma("hello/world"), false);
  assert.equal(isValidDictionaryLemma("ordinary."), false);
  assert.equal(isValidDictionaryLemma("two..dots"), false);
  assert.equal(isValidDictionaryLemma("a".repeat(161)), false);
});
