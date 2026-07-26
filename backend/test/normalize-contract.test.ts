import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidWordQuery, normalizeWord } from "../src/words/normalize.js";

interface ContractCase { input: string; normalized: string; valid: boolean; }

const contract = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../resources/normalize-contract.json", import.meta.url)), "utf8"),
) as { cases: ContractCase[] };

// The frontend asserts the same table (frontend/src/domain/normalize.contract.test.ts),
// so any divergence between the two normalizeWord copies fails CI.
test("normalizeWord/isValidWordQuery match the shared frontend/backend contract", () => {
  assert.ok(contract.cases.length > 0);
  for (const { input, normalized, valid } of contract.cases) {
    assert.equal(normalizeWord(input), normalized, `normalizeWord(${JSON.stringify(input)})`);
    assert.equal(isValidWordQuery(normalized), valid, `isValidWordQuery(${JSON.stringify(normalized)})`);
  }
});
