import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { entryIdOf } from "../src/study/entry-id.js";
import { SqliteStudyStore } from "../src/study/sqlite-store.js";
import { InMemoryStudyStore } from "../src/study/store.js";
import type { AccountUser, StudyStore, StudyWordEntry } from "../src/study/types.js";

const CLIENT = "export-client-12345678";

function entry(word: string, definition?: string): StudyWordEntry {
  return {
    word,
    phonetic: `/${word}/`,
    source: "user",
    meanings: [{ pos: "noun", definition: definition ?? `${word} definition` }],
  };
}

async function sqliteFixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "vacab-export-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return { databaseFile: path.join(directory, "study.sqlite") };
}

type ExportedStudy = {
  account: { username: string };
  collection: {
    wordbooks: Array<{ title: string; words: Array<{ id: string; addedAt: string; entryId: string }> }>;
    drafts: Array<{ id: string; entries: Array<Record<string, unknown>> }>;
  };
  dictionary: Record<string, StudyWordEntry>;
  catalogUploads: Array<Record<string, unknown>>;
  revisions: Array<{ kind: string; changes: Array<{ kind: string; key: string }> }>;
};

async function exportStudy(store: Pick<StudyStore, "exportUserData">, userId: string): Promise<ExportedStudy> {
  const exported = await store.exportUserData(userId);
  assert.ok(exported);
  return exported as ExportedStudy;
}

async function seedAccount(store: Pick<StudyStore, "createUser">): Promise<AccountUser> {
  const created = await store.createUser("Alice", "hash", CLIENT);
  assert.ok(created.kind === "created", "Alice created");
  return created.user;
}

test("account export deduplicates word content into a dictionary section (memory store)", async () => {
  const store = new InMemoryStudyStore();
  const user = await seedAccount(store);
  const alpha = entry("alpha");
  const beta = entry("beta");
  const gamma = entry("gamma");
  // beta appears in both wordbooks, so its content must be stored exactly once.
  const first = await store.createMyWordbook(CLIENT, { title: "A", words: [alpha, beta] });
  const second = await store.createMyWordbook(CLIENT, { title: "B", words: [alpha, gamma] });
  assert.ok(first && second);

  const study = await exportStudy(store, user.id);
  assert.deepEqual(study.collection.wordbooks.map((book) => book.title), ["A", "B"]);

  // Every wordbook word is a lightweight reference, never a full content copy.
  for (const book of study.collection.wordbooks) {
    for (const word of book.words) {
      assert.equal(typeof word.id, "string");
      assert.equal(typeof word.addedAt, "string");
      assert.equal(word.entryId.startsWith("entry-"), true);
      // Every reference resolves to content in the deduplicated dictionary section.
      assert.ok(study.dictionary[word.entryId], "reference resolves in dictionary");
    }
  }

  const alphaId = entryIdOf(alpha);
  const betaId = entryIdOf(beta);
  const gammaId = entryIdOf(gamma);
  assert.deepEqual(study.collection.wordbooks[0]!.words.map((word) => word.entryId), [alphaId, betaId]);
  assert.deepEqual(study.collection.wordbooks[1]!.words.map((word) => word.entryId), [alphaId, gammaId]);

  // Deduplication: shared content resolves to one dictionary entry, and the map is self-contained.
  assert.deepEqual(Object.keys(study.dictionary).sort(), [alphaId, betaId, gammaId].sort());
  assert.deepEqual(study.dictionary[alphaId], alpha);
  assert.deepEqual(study.dictionary[betaId], beta);
  assert.deepEqual(study.dictionary[gammaId], gamma);
});

test("account export keeps catalog metadata and revision diff keys without embedding word content", async () => {
  const store = new InMemoryStudyStore();
  const user = await seedAccount(store);
  const alpha = entry("alpha");
  const source = await store.createMyWordbook(CLIENT, { title: "Source", words: [alpha] });
  assert.ok(source);
  const catalog = await store.uploadCatalog(CLIENT, {
    sourceWordbookId: source.id,
    visibility: "public",
    author: { userId: user.id, username: user.username },
  });
  assert.ok(catalog);

  const study = await exportStudy(store, user.id);

  // Catalog uploads keep metadata (and the source reference) but no embedded word list.
  assert.equal(study.catalogUploads.length, 1);
  assert.equal(study.catalogUploads[0]!.sourceWordbookId, source.id);
  assert.equal("words" in study.catalogUploads[0]!, false);

  // The publish revision keeps the diff keys but no full word content.
  assert.equal(study.revisions.length, 1);
  assert.equal(study.revisions[0]!.kind, "initial");
  assert.deepEqual(study.revisions[0]!.changes, [{ kind: "add", key: "alpha" }]);

  // Wordbook content still resolves through the dictionary section.
  assert.deepEqual(study.dictionary[entryIdOf(alpha)], alpha);
});

test("account export deduplicates import draft content into the dictionary section", async () => {
  const store = new InMemoryStudyStore();
  const user = await seedAccount(store);
  const alpha = entry("alpha");
  const created = await store.createImportDrafts(CLIENT, { title: "Import", lines: [{ line: 1, word: "alpha" }] });
  const draft = created[0]!;
  await store.resolveImportDraftEntries(CLIENT, draft.id, [{ id: draft.entries[0]!.id, status: "ready", entry: alpha }]);

  const study = await exportStudy(store, user.id);

  // Draft entries keep metadata and a reference; the content lives once in the dictionary.
  assert.equal(study.collection.drafts.length, 1);
  const draftEntry = study.collection.drafts[0]!.entries[0]!;
  assert.equal("entry" in draftEntry, false);
  assert.equal(draftEntry.entryId, entryIdOf(alpha));
  assert.equal(draftEntry.word, "alpha");
  assert.deepEqual(study.dictionary[entryIdOf(alpha)], alpha);
});

test("SQLite export uses the same content-addressed ids as dictionary_entries", async (t) => {
  const { databaseFile } = await sqliteFixture(t);
  const store = new SqliteStudyStore(databaseFile);
  try {
    const user = await seedAccount(store);
    const alpha = entry("alpha");
    const beta = entry("beta");
    const gamma = entry("gamma");
    // beta is shared across wordbooks: the normalized store dedups it into one dictionary row.
    const first = await store.createMyWordbook(CLIENT, { title: "A", words: [alpha, beta] });
    const second = await store.createMyWordbook(CLIENT, { title: "B", words: [alpha, gamma] });
    assert.ok(first && second);

    const study = await exportStudy(store, user.id);
    const alphaId = entryIdOf(alpha);
    const betaId = entryIdOf(beta);
    const gammaId = entryIdOf(gamma);

    // Export entry ids match the persisted content-addressed rows.
    const db = new Database(databaseFile);
    try {
      const storedIds = db.prepare("SELECT id FROM dictionary_entries ORDER BY id").all() as Array<{ id: string }>;
      assert.deepEqual(storedIds.map((row) => row.id).sort(), [alphaId, betaId, gammaId].sort());
    } finally {
      db.close();
    }

    // Wordbook references point at the shared id, and the dictionary section is self-contained.
    assert.deepEqual(study.collection.wordbooks[0]!.words.map((word) => word.entryId), [alphaId, betaId]);
    assert.deepEqual(study.collection.wordbooks[1]!.words.map((word) => word.entryId), [alphaId, gammaId]);
    assert.deepEqual(Object.keys(study.dictionary).sort(), [alphaId, betaId, gammaId].sort());
    assert.deepEqual(study.dictionary[betaId], beta);
  } finally {
    store.close();
  }
});
