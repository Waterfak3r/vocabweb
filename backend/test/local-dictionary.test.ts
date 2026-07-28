import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import { FallbackDictionaryProvider } from "../src/providers/fallback-dictionary.js";
import { SqliteLocalDictionaryProvider } from "../src/providers/local-dictionary.js";
import type { WordProvider } from "../src/words/types.js";

const directory = await mkdtemp(resolve(tmpdir(), "vacab-local-dict-"));
const file = resolve(directory, "dictionary.sqlite");
const db = new Database(file);
db.exec(`
  CREATE TABLE dictionary_entries(lemma TEXT PRIMARY KEY, phonetic TEXT NOT NULL, zh_meaning TEXT, tags TEXT, bnc INTEGER, frq INTEGER);
  CREATE TABLE dictionary_meanings(id INTEGER PRIMARY KEY, lemma TEXT, pos TEXT, definition TEXT, example TEXT, source_record_id TEXT, sort_order INTEGER);
  INSERT INTO dictionary_entries VALUES ('resilient', 'rɪˈzɪliənt', '有韧性的', 'ielts', 1, 1);
  INSERT INTO dictionary_entries VALUES ('longtail', '', '长尾', '', NULL, NULL);
  INSERT INTO dictionary_entries VALUES ('resilience', '', '恢复力', '', 2, 2);
  INSERT INTO dictionary_entries VALUES ('irresilient', '', '无弹性的', '', 3, 3);
  INSERT INTO dictionary_entries VALUES ('a lot of', '', '许多\n大量的', '', 4, 4);
  INSERT INTO dictionary_meanings VALUES (1, 'resilient', 'a', 'recovering readily from adversity', 'a resilient learner', 'fixture:1', 1);
  INSERT INTO dictionary_meanings VALUES (2, 'a lot of', 'phrase', 'a large amount or number of', 'a lot of time', 'fixture:2', 2);
`);
db.close();
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("local dictionary exposes bilingual data and provenance", async () => {
  const provider = new SqliteLocalDictionaryProvider(file);
  const entry = await provider.lookup("Resilient");
  assert.equal(entry?.zhMeaning, "有韧性的");
  assert.equal(entry?.meanings[0]?.definition, "recovering readily from adversity");
  assert.deepEqual(entry?.availableLanguages, ["zh", "en"]);
  assert.deepEqual(entry?.sources?.map((source) => source.id), ["open_english_wordnet", "ecdict"]);
  provider.close();
});

test("remote fallback runs only when local English is missing and keeps local Chinese", async () => {
  let calls = 0;
  const remote: WordProvider = { async lookup(word) { calls += 1; return { word, phonetic: "/x/", meanings: [{ pos: "noun", definition: "remote definition" }], source: "backend" }; } };
  const local = new SqliteLocalDictionaryProvider(file);
  const provider = new FallbackDictionaryProvider(local, remote);
  assert.equal((await provider.lookup("resilient"))?.meanings[0]?.definition, "recovering readily from adversity");
  assert.equal(calls, 0);
  const fallback = await provider.lookup("longtail");
  assert.equal(calls, 1);
  assert.equal(fallback?.zhMeaning, "长尾");
  assert.equal(fallback?.meanings[0]?.definition, "remote definition");
  assert.deepEqual(fallback?.availableLanguages, ["zh", "en"]);
  local.close();
});

test("local dictionary looks up phrases and ranks exact, prefix, then contains suggestions", async () => {
  const provider = new SqliteLocalDictionaryProvider(file);
  const phrase = await provider.lookup("  A   LOT OF ");
  assert.equal(phrase?.word, "a lot of");
  assert.equal(phrase?.meanings[0]?.definition, "a large amount or number of");
  assert.equal(phrase?.zhMeaning, "许多\n大量的");

  assert.deepEqual(await provider.suggest("res", 3), [
    { word: "resilient", zhMeaning: "有韧性的", kind: "word" },
    { word: "resilience", zhMeaning: "恢复力", kind: "word" },
    { word: "irresilient", zhMeaning: "无弹性的", kind: "word" },
  ]);
  assert.deepEqual(await provider.suggest("a lot", 1), [
    { word: "a lot of", zhMeaning: "许多", kind: "phrase" },
  ]);
  assert.deepEqual(await provider.suggest("许多", 8), [
    { word: "a lot of", zhMeaning: "许多", kind: "phrase" },
  ]);
  assert.deepEqual(await provider.suggest("恢复", 8), [
    { word: "resilience", zhMeaning: "恢复力", kind: "word" },
  ]);
  provider.close();
});
