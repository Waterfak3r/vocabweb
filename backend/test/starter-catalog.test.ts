import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { SqliteLocalDictionaryProvider } from "../src/providers/local-dictionary.js";
import { ensureStarterCatalog } from "../src/study/starter-catalog.js";
import { JsonFileStudyStore } from "../src/study/store.js";

const directory = await mkdtemp(resolve(tmpdir(), "vacab-starter-"));
const dictionaryFile = resolve(directory, "dictionary.sqlite");
const stateFile = resolve(directory, "state.json");
const db = new Database(dictionaryFile);
db.exec(`
  CREATE TABLE dictionary_entries(lemma TEXT PRIMARY KEY, phonetic TEXT NOT NULL, zh_meaning TEXT, tags TEXT, bnc INTEGER, frq INTEGER);
  CREATE TABLE dictionary_meanings(id INTEGER PRIMARY KEY, lemma TEXT, pos TEXT, definition TEXT, example TEXT, source_record_id TEXT, sort_order INTEGER);
`);
const insertEntry = db.prepare("INSERT INTO dictionary_entries VALUES (?, '', ?, ?, ?, ?)");
const insertMeaning = db.prepare("INSERT INTO dictionary_meanings(lemma, pos, definition, source_record_id, sort_order) VALUES (?, 'n', ?, ?, ?)");
const alpha = (value: number) => {
  let result = "";
  for (let place = 0; place < 3; place += 1) { result = String.fromCharCode(97 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};
["cet4", "cet6", "ky", "ielts", "toefl"].forEach((tag, group) => {
  for (let index = 0; index < 500; index += 1) {
    const lemma = `${String.fromCharCode(97 + group)}${alpha(index)}`;
    insertEntry.run(lemma, `释义 ${index}`, tag, index + 1, index + 1);
    insertMeaning.run(lemma, `definition ${index}`, `${tag}:${index}`, index);
  }
});
db.close();
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("starter catalog creates five stable 500-word public books for Waterfak3r", async () => {
  const store = new JsonFileStudyStore(stateFile);
  const created = await store.createUser("Waterfak3r", "unused-test-hash", "starter-client");
  assert.equal(created.kind, "created");
  const dictionary = new SqliteLocalDictionaryProvider(dictionaryFile);
  const first = await ensureStarterCatalog({ store, dictionary, dictionaryFile, log: { info() {}, warn() {} } });
  const second = await ensureStarterCatalog({ store, dictionary, dictionaryFile, log: { info() {}, warn() {} } });
  assert.deepEqual(first, { seeded: 5, skipped: false });
  assert.deepEqual(second, { seeded: 5, skipped: false });
  const catalog = await store.listCatalog("reader-client", { sort: "newest" });
  assert.equal(catalog.length, 5);
  assert.ok(catalog.every((book) => book.wordCount === 500 && book.author === "Waterfak3r" && book.visibility === "public"));
  assert.deepEqual(new Set(catalog.flatMap((book) => book.exams)), new Set(["四级", "六级", "考研", "IELTS", "TOEFL"]));
  dictionary.close();
});
