import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { SqliteEngagementStore } from "../src/engagement/store.js";
import type { State } from "../src/study/ladder.js";
import { PRIVATE_SCHEMA_MIGRATION_KEY, PRIVATE_STATE_MIGRATION_KEY } from "../src/study/sqlite-private-state.js";
import { SqliteStudyStore } from "../src/study/sqlite-store.js";
import type { StudyRoundView, StudyWordEntry, WordbookStudyPreferences } from "../src/study/types.js";

const CLIENT = "normalized-client-12345678";

class CountingSqliteStudyStore extends SqliteStudyStore {
  loadCount = 0;

  protected override async load(): Promise<State> {
    this.loadCount += 1;
    return await super.load();
  }
}

class SaveBarrier {
  private arrivals = 0;
  private readonly released: Promise<void>;
  private release!: () => void;

  constructor() {
    this.released = new Promise<void>((resolve) => { this.release = resolve; });
  }

  async arrive(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) this.release();
    await this.released;
  }
}

class BarrierSqliteStudyStore extends SqliteStudyStore {
  private pauseNextSave = true;

  constructor(databaseFile: string, private readonly barrier: SaveBarrier, now: () => Date) {
    super(databaseFile, { now });
  }

  protected override async save(state: State, previous?: State): Promise<void> {
    if (this.pauseNextSave) {
      this.pauseNextSave = false;
      await this.barrier.arrive();
    }
    await super.save(state, previous);
  }
}

function entry(word: string, definition = `${word} definition`): StudyWordEntry {
  return {
    word,
    phonetic: "",
    source: "user",
    meanings: [{ pos: "noun", definition }],
  };
}

function selfRatingPreferences(newWords = 20): WordbookStudyPreferences {
  return {
    plan: { newWords, dictation: 0, backlogReviews: 50 },
    modes: {
      new: {
        meaningPreference: "en",
        showExamples: true,
        showPhonetic: true,
        autoPlayAudio: false,
        exerciseTypes: ["self-rating"],
      },
      review: {
        meaningPreference: "en",
        showExamples: true,
        showPhonetic: true,
        autoPlayAudio: false,
        exerciseTypes: ["self-rating"],
      },
      dictation: {
        meaningPreference: "en",
        showExamples: true,
        showPhonetic: false,
        autoPlayAudio: false,
        underlineMistakes: true,
        showMeaning: true,
        showCharacterMask: false,
      },
    },
  };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "vacab-normalized-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return {
    databaseFile: path.join(directory, "study.sqlite"),
    legacyJsonFile: path.join(directory, "study-state.json"),
  };
}

async function serve(store: SqliteStudyStore) {
  const http: Server = createApp({ studyStore: store }).listen(0);
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())),
  };
}

function auditCounts(db: Database.Database): Record<string, number> {
  const rows = db.prepare(`
    SELECT table_name || ':' || action AS key, COUNT(*) AS count
    FROM write_audit
    GROUP BY table_name, action
    ORDER BY table_name, action
  `).all() as Array<{ key: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.count]));
}

test("fresh SQLite databases record the no-source migration and reopen cleanly", async (t) => {
  const files = await fixture(t);
  const store = new CountingSqliteStudyStore(files.databaseFile);
  await store.checkHealth();
  assert.equal(store.loadCount, 1);
  assert.deepEqual(await store.listMyWordbooks(CLIENT, false), []);
  assert.equal(store.loadCount, 1);
  store.close();

  const db = new Database(files.databaseFile, { readonly: true });
  const markers = Object.fromEntries((db.prepare(`
    SELECT key, value
    FROM metadata
    WHERE key IN ('legacy_json_import_v1', ?)
  `).all(PRIVATE_STATE_MIGRATION_KEY) as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]));
  assert.equal(markers.legacy_json_import_v1, "no-source");
  assert.deepEqual(JSON.parse(markers[PRIVATE_STATE_MIGRATION_KEY]!), { status: "complete", clients: 0 });
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of ["dictionary_entries", "wordbooks", "wordbook_words", "study_events", "study_states", "study_rounds", "study_round_tasks"]) {
    assert.equal(tables.has(table), true, `missing normalized table ${table}`);
  }
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.deepEqual(await reopened.listMyWordbooks(CLIENT, false), []);
  reopened.close();
});

test("SQLite upgrades the intermediate client-only word-id primary key", async (t) => {
  const files = await fixture(t);
  const seed = new SqliteStudyStore(files.databaseFile);
  const created = await seed.createMyWordbook(CLIENT, { title: "Old normalized key", words: [entry("upgrade")] });
  const word = (await seed.listWords(CLIENT, created.id))![0]!;
  seed.close();

  const old = new Database(files.databaseFile);
  old.exec(`
    DROP INDEX wordbook_words_book_position_idx;
    DROP INDEX wordbook_words_book_word_idx;
    DROP INDEX wordbook_words_entry_idx;
    ALTER TABLE wordbook_words RENAME TO wordbook_words_scoped_key;
    CREATE TABLE wordbook_words (
      id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      wordbook_id TEXT NOT NULL,
      entry_id TEXT NOT NULL REFERENCES dictionary_entries(id),
      normalized_word TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      base_revision TEXT NOT NULL,
      override_json TEXT,
      deleted_at TEXT,
      PRIMARY KEY (client_id, id),
      FOREIGN KEY (client_id, wordbook_id) REFERENCES wordbooks(client_id, id) ON DELETE CASCADE
    );
    INSERT INTO wordbook_words
    SELECT * FROM wordbook_words_scoped_key;
    DROP TABLE wordbook_words_scoped_key;
  `);
  assert.deepEqual(
    (old.prepare("PRAGMA table_info(wordbook_words)").all() as Array<{ name: string; pk: number }>)
      .filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name),
    ["client_id", "id"],
  );
  old.close();

  const upgraded = new SqliteStudyStore(files.databaseFile);
  assert.equal((await upgraded.listWords(CLIENT, created.id))?.[0]?.id, word.id);
  upgraded.close();
  const db = new Database(files.databaseFile, { readonly: true });
  assert.deepEqual(
    (db.prepare("PRAGMA table_info(wordbook_words)").all() as Array<{ name: string; pk: number }>)
      .filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name),
    ["client_id", "wordbook_id", "id"],
  );
  const marker = db.prepare("SELECT value FROM metadata WHERE key = ?").get(PRIVATE_SCHEMA_MIGRATION_KEY) as { value: string };
  assert.deepEqual(JSON.parse(marker.value).primaryKey, ["client_id", "wordbook_id", "id"]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
});

test("SQLite atomically migrates a complete legacy client document to normalized rows", async (t) => {
  const files = await fixture(t);
  const wordId = "word-stable-alpha";
  const roundId = "round-stable-alpha";
  const occurredAt = "2026-07-01T12:00:00.000Z";
  const attributedEntry = {
    ...entry("alpha"),
    availableLanguages: ["zh", "en"],
    sources: [{ id: "open_english_wordnet", name: "Open English WordNet", version: "2024", license: "CC BY 4.0" }],
    meanings: [{ pos: "noun", definition: "alpha definition", sourceId: "open_english_wordnet" }],
  };
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    revisions: [],
    contributions: [],
    users: [],
    userAvatars: {},
    sessions: [],
    clients: {
      [CLIENT]: {
        favorites: ["catalog-missing-but-retained"],
        wordbooks: [{
          id: "my-legacy-normalized",
          title: "Legacy normalized",
          description: "",
          sourceCatalogId: "catalog-source",
          sourceRevisionId: "revision-original-baseline",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: occurredAt,
          words: [{ ...attributedEntry, id: wordId, addedAt: "2026-01-01T00:00:00.000Z" }],
        }],
        events: [{
          id: "retained-my-legacy-normalized-word-stable-alpha",
          kind: "mark",
          wordbookId: "my-legacy-normalized",
          wordId,
          word: "alpha",
          level: 2,
          occurredAt,
          retainedState: {
            recognitionStreak: 1,
            reviewIntervalDays: 3,
            nextReviewAt: "2026-07-04T12:00:00.000Z",
            easeFactor: 2.1,
            relearning: false,
          },
        }],
        drafts: [{
          id: "draft-legacy",
          groupId: "group-legacy",
          title: "Draft",
          description: "",
          batchIndex: 0,
          totalBatches: 1,
          status: "pending",
          createdAt: occurredAt,
          updatedAt: occurredAt,
          entries: [{ id: "draft-entry-legacy", line: 1, word: "beta", status: "ready", entry: entry("beta") }],
        }],
        studyRounds: [{
          id: roundId,
          wordbookId: "my-legacy-normalized",
          mode: "review",
          scope: "standard",
          meaningPreference: "en",
          exerciseTypes: ["self-rating"],
          wordIds: [wordId],
          queue: [{ id: "task-stable-alpha", wordId, exercise: "self-rating" }],
          passedTaskKeys: [],
          completedWordIds: [],
          masteredWordIds: [],
          vagueWordIds: [],
          unknownWordIds: [],
          processedOperationIds: ["operation-already-processed"],
          revision: 3,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }],
      },
    },
  }), "utf8");

  const store = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  const restoredBook = await store.getMyWordbook(CLIENT, "my-legacy-normalized");
  assert.equal(restoredBook?.sourceRevisionId, "revision-original-baseline");
  const restoredWord = (await store.listWords(CLIENT, "my-legacy-normalized"))?.[0] as StudyWordEntry & {
    availableLanguages?: string[];
    sources?: Array<{ id: string }>;
    meanings: Array<StudyWordEntry["meanings"][number] & { sourceId?: string }>;
    id?: string;
  } | undefined;
  assert.equal(restoredWord?.id, wordId);
  assert.deepEqual(restoredWord?.availableLanguages, ["zh", "en"]);
  assert.equal(restoredWord?.sources?.[0]?.id, "open_english_wordnet");
  assert.equal(restoredWord?.meanings[0]?.sourceId, "open_english_wordnet");
  assert.equal((await store.getStudyRound(CLIENT, roundId))?.queue[0]?.id, "task-stable-alpha");
  store.close();

  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT data_json FROM clients WHERE client_id = ?").get(CLIENT) as { data_json: string }).data_json, "{}");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbooks").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbook_words WHERE deleted_at IS NULL").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_events").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_states").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM import_draft_entries").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_round_tasks").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_round_operations").get() as { count: number }).count, 1);
  const marker = db.prepare("SELECT value FROM metadata WHERE key = ?").get(PRIVATE_STATE_MIGRATION_KEY) as { value: string };
  assert.equal(JSON.parse(marker.value).status, "complete");
  db.close();

  const reopened = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.equal((await reopened.listWords(CLIENT, "my-legacy-normalized"))?.[0]?.id, wordId);
  assert.equal((await reopened.getStudyRound(CLIENT, roundId))?.processedOperationIds[0], "operation-already-processed");
  reopened.close();
});

test("concurrent first open imports and normalizes legacy data exactly once", async (t) => {
  const files = await fixture(t);
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    revisions: [],
    contributions: [],
    users: [],
    userAvatars: {},
    sessions: [],
    clients: {
      [CLIENT]: {
        favorites: [],
        events: [],
        drafts: [],
        studyRounds: [],
        wordbooks: [{
          id: "my-concurrent-import",
          title: "Concurrent",
          description: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          words: [{ ...entry("atomic"), id: "word-atomic", addedAt: "2026-01-01T00:00:00.000Z" }],
        }],
      },
    },
  }), "utf8");
  const first = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  const second = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  const [left, right] = await Promise.all([
    first.listWords(CLIENT, "my-concurrent-import"),
    second.listWords(CLIENT, "my-concurrent-import"),
  ]);
  assert.equal(left?.[0]?.id, "word-atomic");
  assert.equal(right?.[0]?.id, "word-atomic");
  first.close();
  second.close();
  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbook_words").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM metadata WHERE key IN ('legacy_json_import_v1', ?)").get(PRIVATE_STATE_MIGRATION_KEY) as { count: number }).count, 2);
  db.close();
});

test("malformed legacy input leaves no partial private migration and can be retried", async (t) => {
  const files = await fixture(t);
  await writeFile(files.legacyJsonFile, "{ malformed", "utf8");
  const broken = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  await assert.rejects(broken.listMyWordbooks(CLIENT, false));
  broken.close();
  let db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM metadata WHERE key IN ('legacy_json_import_v1', ?)").get(PRIVATE_STATE_MIGRATION_KEY) as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbooks").get() as { count: number }).count, 0);
  db.close();

  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    clients: { [CLIENT]: { favorites: [], wordbooks: [], events: [], drafts: [], studyRounds: [] } },
  }), "utf8");
  const retried = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.deepEqual(await retried.listMyWordbooks(CLIENT, false), []);
  retried.close();
  db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM metadata WHERE key IN ('legacy_json_import_v1', ?)").get(PRIVATE_STATE_MIGRATION_KEY) as { count: number }).count, 2);
  db.close();
});

test("study-state projections replay out-of-order events chronologically", async (t) => {
  const files = await fixture(t);
  const wordId = "word-rewound-clock";
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    clients: {
      [CLIENT]: {
        favorites: [],
        drafts: [],
        studyRounds: [],
        wordbooks: [{
          id: "my-rewound-clock",
          title: "Rewound clock",
          description: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
          words: [{ ...entry("clock"), id: wordId, addedAt: "2026-01-01T00:00:00.000Z" }],
        }],
        events: [
          {
            id: "event-later",
            kind: "flashcard",
            verdict: "unknown",
            wordbookId: "my-rewound-clock",
            wordId,
            word: "clock",
            occurredAt: "2026-07-02T00:00:00.000Z",
          },
          {
            id: "event-earlier",
            kind: "mark",
            level: 3,
            wordbookId: "my-rewound-clock",
            wordId,
            word: "clock",
            occurredAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    },
  }), "utf8");

  const store = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  await store.listWords(CLIENT, "my-rewound-clock");
  store.close();
  const db = new Database(files.databaseFile, { readonly: true });
  const projection = db.prepare(`
    SELECT level, last_studied_at
    FROM study_states
    WHERE client_id = ? AND wordbook_id = ? AND wordbook_word_id = ?
  `).get(CLIENT, "my-rewound-clock", wordId) as { level: number; last_studied_at: string };
  assert.deepEqual(projection, { level: 2, last_studied_at: "2026-07-02T00:00:00.000Z" });
  const eventOrder = (db.prepare("SELECT id FROM study_events ORDER BY sequence").all() as Array<{ id: string }>).map((row) => row.id);
  assert.deepEqual(eventOrder, ["event-later", "event-earlier"]);
  db.close();
});

test("SQLite answer writes one event and state row, resumes the row queue, and is idempotent through HTTP", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  const book = await store.createMyWordbook(CLIENT, { title: "Atomic answers", words: [entry("alpha"), entry("beta")] });
  await store.updateMyWordbook(CLIENT, book.id, { studyPreferences: selfRatingPreferences(2) });
  const app = await serve(store);
  const headers = { "content-type": "application/json", "x-vocab-client-id": CLIENT };
  try {
    const startedResponse = await fetch(`${app.baseUrl}/api/study/rounds`, {
      method: "POST",
      headers,
      body: JSON.stringify({ wordbookId: book.id, mode: "new" }),
    });
    assert.equal(startedResponse.status, 201);
    const started = (await startedResponse.json() as { round: StudyRoundView }).round;
    const firstTask = started.queue[0]!;
    const operationId = randomUUID();

    const db = new Database(files.databaseFile);
    db.exec(`
      CREATE TABLE write_audit(table_name TEXT NOT NULL, action TEXT NOT NULL);
      CREATE TRIGGER audit_clients_update AFTER UPDATE ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'update'); END;
      CREATE TRIGGER audit_dictionary_insert AFTER INSERT ON dictionary_entries BEGIN INSERT INTO write_audit VALUES ('dictionary_entries', 'insert'); END;
      CREATE TRIGGER audit_dictionary_update AFTER UPDATE ON dictionary_entries BEGIN INSERT INTO write_audit VALUES ('dictionary_entries', 'update'); END;
      CREATE TRIGGER audit_wordbook_words_insert AFTER INSERT ON wordbook_words BEGIN INSERT INTO write_audit VALUES ('wordbook_words', 'insert'); END;
      CREATE TRIGGER audit_wordbook_words_update AFTER UPDATE ON wordbook_words BEGIN INSERT INTO write_audit VALUES ('wordbook_words', 'update'); END;
      CREATE TRIGGER audit_wordbooks_update AFTER UPDATE ON wordbooks BEGIN INSERT INTO write_audit VALUES ('wordbooks', 'update'); END;
      CREATE TRIGGER audit_events_insert AFTER INSERT ON study_events BEGIN INSERT INTO write_audit VALUES ('study_events', 'insert'); END;
      CREATE TRIGGER audit_events_update AFTER UPDATE ON study_events BEGIN INSERT INTO write_audit VALUES ('study_events', 'update'); END;
      CREATE TRIGGER audit_states_insert AFTER INSERT ON study_states BEGIN INSERT INTO write_audit VALUES ('study_states', 'insert'); END;
      CREATE TRIGGER audit_states_update AFTER UPDATE ON study_states BEGIN INSERT INTO write_audit VALUES ('study_states', 'update'); END;
      CREATE TRIGGER audit_rounds_update AFTER UPDATE ON study_rounds BEGIN INSERT INTO write_audit VALUES ('study_rounds', 'update'); END;
      CREATE TRIGGER audit_tasks_insert AFTER INSERT ON study_round_tasks BEGIN INSERT INTO write_audit VALUES ('study_round_tasks', 'insert'); END;
      CREATE TRIGGER audit_tasks_update AFTER UPDATE ON study_round_tasks BEGIN INSERT INTO write_audit VALUES ('study_round_tasks', 'update'); END;
      CREATE TRIGGER audit_tasks_delete AFTER DELETE ON study_round_tasks BEGIN INSERT INTO write_audit VALUES ('study_round_tasks', 'delete'); END;
      CREATE TRIGGER audit_flags_insert AFTER INSERT ON study_round_flags BEGIN INSERT INTO write_audit VALUES ('study_round_flags', 'insert'); END;
      CREATE TRIGGER audit_operations_insert AFTER INSERT ON study_round_operations BEGIN INSERT INTO write_audit VALUES ('study_round_operations', 'insert'); END;
    `);

    const answerInput = {
      taskId: firstTask.id,
      response: "vague",
      operationId,
      revision: started.revision,
    };
    const answerResponse = await fetch(`${app.baseUrl}/api/study/rounds/${started.id}/answers`, {
      method: "POST",
      headers,
      body: JSON.stringify(answerInput),
    });
    assert.equal(answerResponse.status, 200);
    const answered = await answerResponse.json() as StudyRoundView;
    assert.equal(answered.processedOperationIds.includes(operationId), true);
    assert.equal(answered.queue.at(-1)?.wordId, firstTask.wordId);
    assert.notEqual(answered.queue.at(-1)?.id, firstTask.id);

    const writes = auditCounts(db);
    assert.equal(writes["study_events:insert"], 1);
    assert.equal(writes["study_states:insert"], 1);
    assert.equal(writes["study_rounds:update"], 1);
    assert.equal(writes["study_round_operations:insert"], 1);
    assert.equal(writes["wordbooks:update"], 1);
    assert.equal(writes["clients:update"] ?? 0, 0);
    assert.equal(writes["dictionary_entries:insert"] ?? 0, 0);
    assert.equal(writes["dictionary_entries:update"] ?? 0, 0);
    assert.equal(writes["wordbook_words:insert"] ?? 0, 0);
    assert.equal(writes["wordbook_words:update"] ?? 0, 0);

    db.prepare("DELETE FROM write_audit").run();
    const repeated = await fetch(`${app.baseUrl}/api/study/rounds/${started.id}/answers`, {
      method: "POST",
      headers,
      body: JSON.stringify(answerInput),
    });
    assert.equal(repeated.status, 200);
    assert.deepEqual(auditCounts(db), {});
    assert.equal((db.prepare("SELECT data_json FROM clients WHERE client_id = ?").get(CLIENT) as { data_json: string }).data_json, "{}");
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT wordbook_word_id
      FROM study_states
      WHERE client_id = ? AND wordbook_id = ? AND next_review_at <= ?
      ORDER BY next_review_at, wordbook_word_id
      LIMIT 20
    `).all(CLIENT, book.id, "2099-01-01T00:00:00.000Z") as Array<{ detail: string }>;
    assert.equal(plan.some((row) => row.detail.includes("study_states_due_idx")), true);
    db.close();

    await app.close();
    store.close();
    const reopened = new SqliteStudyStore(files.databaseFile);
    const restored = await reopened.getStudyRound(CLIENT, started.id);
    assert.deepEqual(restored?.queue, answered.queue);
    assert.equal(restored?.processedOperationIds.includes(operationId), true);
    assert.equal((await reopened.listWords(CLIENT, book.id))?.find((word) => word.id === firstTask.wordId)?.level, 0);
    reopened.close();
  } finally {
    if (store) {
      try { await app.close(); } catch { /* already closed */ }
      store.close();
    }
  }
});

test("wordbook-local overrides keep stable word ids and do not leak across books", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  const base = entry("bank", "a financial institution");
  const first = await store.createMyWordbook(CLIENT, { title: "First bank", words: [base] });
  const second = await store.createMyWordbook(CLIENT, { title: "Second bank", words: [base] });
  const firstWord = (await store.listWords(CLIENT, first.id))![0]!;
  const secondWord = (await store.listWords(CLIENT, second.id))![0]!;

  const db = new Database(files.databaseFile);
  const beforeLinks = db.prepare(`
    SELECT id, entry_id, base_revision, override_json
    FROM wordbook_words
    WHERE id IN (?, ?)
    ORDER BY id
  `).all(firstWord.id, secondWord.id) as Array<{ id: string; entry_id: string; base_revision: string; override_json: string | null }>;
  assert.equal(beforeLinks.length, 2);
  assert.equal(beforeLinks[0]?.entry_id, beforeLinks[1]?.entry_id);
  assert.equal(beforeLinks.every((row) => row.override_json === null), true);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries").get() as { count: number }).count, 1);

  const updated = await store.updateWord(CLIENT, first.id, firstWord.id, {
    phonetic: "/bæŋk/",
    meanings: [{ pos: "noun", definition: "the edge of a river" }],
  });
  assert.equal(updated.kind, "updated");
  const afterLinks = db.prepare(`
    SELECT id, entry_id, base_revision, override_json
    FROM wordbook_words
    WHERE id IN (?, ?)
    ORDER BY id
  `).all(firstWord.id, secondWord.id) as Array<{ id: string; entry_id: string; base_revision: string; override_json: string | null }>;
  const firstLink = afterLinks.find((row) => row.id === firstWord.id)!;
  const secondLink = afterLinks.find((row) => row.id === secondWord.id)!;
  assert.equal(firstLink.entry_id, secondLink.entry_id);
  assert.equal(firstLink.base_revision, secondLink.base_revision);
  assert.ok(firstLink.override_json);
  assert.equal(secondLink.override_json, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries").get() as { count: number }).count, 1);

  const deleted = await store.batchWords(CLIENT, first.id, { action: "delete", wordIds: [firstWord.id] });
  assert.deepEqual(deleted?.succeededIds, [firstWord.id]);
  assert.ok((db.prepare("SELECT deleted_at FROM wordbook_words WHERE id = ?").get(firstWord.id) as { deleted_at: string | null }).deleted_at);
  db.close();
  store.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.equal((await reopened.listWords(CLIENT, first.id))?.length, 0);
  const isolated = (await reopened.listWords(CLIENT, second.id))![0]!;
  assert.equal(isolated.id, secondWord.id);
  assert.equal(isolated.meanings[0]?.definition, "a financial institution");
  reopened.close();
});

test("SQLite indexed round selection preserves protected, backlog, and ahead semantics", async (t) => {
  const files = await fixture(t);
  let now = new Date("2026-01-01T08:00:00.000Z");
  const store = new SqliteStudyStore(files.databaseFile, { now: () => new Date(now) });
  const book = await store.createMyWordbook(CLIENT, {
    title: "Indexed tiered review",
    words: [entry("archive"), entry("archaic"), entry("architect"), entry("recent"), entry("untouched")],
  });
  const words = (await store.listWords(CLIENT, book.id))!;
  for (const word of words.slice(0, 3)) {
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: word.id, verdict: "know" });
  }
  now = new Date("2026-01-18T08:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: words[3]!.id, verdict: "know" });
  const tieredPreferences = selfRatingPreferences(0);
  tieredPreferences.plan.backlogReviews = 1;
  await store.updateMyWordbook(CLIENT, book.id, { studyPreferences: tieredPreferences });
  now = new Date("2026-01-20T08:00:00.000Z");

  const standard = await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review", scope: "standard" });
  assert.deepEqual(standard?.round.wordIds, [words[3]!.id, words[0]!.id]);
  const backlog = await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review", scope: "backlog" });
  assert.deepEqual(backlog?.round.wordIds, words.slice(0, 3).map((word) => word.id));

  now = new Date("2026-01-01T12:00:00.000Z");
  const futureBook = await store.createMyWordbook(CLIENT, {
    title: "Indexed ahead",
    words: [entry("future-one"), entry("future-two")],
  });
  const futureWords = (await store.listWords(CLIENT, futureBook.id))!;
  for (const word of futureWords) {
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: futureBook.id, wordId: word.id, verdict: "know" });
  }
  const ahead = await store.startStudyRound(CLIENT, { wordbookId: futureBook.id, mode: "review", scope: "ahead" });
  assert.deepEqual(ahead?.round.wordIds, futureWords.map((word) => word.id));
  store.close();
});

test("changing a review schedule recomputes the indexed study-state projection", async (t) => {
  const files = await fixture(t);
  let now = new Date("2026-02-01T08:00:00.000Z");
  const store = new SqliteStudyStore(files.databaseFile, { now: () => new Date(now) });
  const book = await store.createMyWordbook(CLIENT, { title: "Projected schedule", words: [entry("interval")] });
  const word = (await store.listWords(CLIENT, book.id))![0]!;
  await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: word.id, verdict: "know" });
  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal(
    (db.prepare("SELECT next_review_at FROM study_states WHERE client_id = ? AND wordbook_word_id = ?").get(CLIENT, word.id) as { next_review_at: string }).next_review_at,
    "2026-02-02T08:00:00.000Z",
  );
  await store.updateMyWordbook(CLIENT, book.id, {
    reviewSchedule: { learningDays: 10, familiarDays: 20, masteredDays: 30, expertDays: 40, lapseDays: 1, maxDays: 60 },
  });
  assert.equal(
    (db.prepare("SELECT next_review_at FROM study_states WHERE client_id = ? AND wordbook_word_id = ?").get(CLIENT, word.id) as { next_review_at: string }).next_review_at,
    "2026-02-11T08:00:00.000Z",
  );
  now = new Date("2026-02-05T08:00:00.000Z");
  assert.deepEqual((await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review" }))?.round.wordIds, []);
  now = new Date("2026-02-12T08:00:00.000Z");
  assert.deepEqual((await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review" }))?.round.wordIds, [word.id]);
  db.close();
  store.close();
});

test("legacy word ids remain scoped to their wordbook within one client", async (t) => {
  const files = await fixture(t);
  const sharedWordId = "word-shared-inside-client";
  const book = (id: string, definition: string) => ({
    id,
    title: definition,
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    words: [{ ...entry("shared", definition), id: sharedWordId, addedAt: "2026-01-01T00:00:00.000Z" }],
  });
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    clients: {
      [CLIENT]: {
        favorites: [],
        drafts: [],
        studyRounds: [],
        wordbooks: [book("my-shared-a", "first meaning"), book("my-shared-b", "second meaning")],
        events: [
          { id: "event-shared-a", kind: "mark", level: 1, wordbookId: "my-shared-a", wordId: sharedWordId, word: "shared", occurredAt: "2026-01-02T00:00:00.000Z" },
          { id: "event-shared-b", kind: "mark", level: 3, wordbookId: "my-shared-b", wordId: sharedWordId, word: "shared", occurredAt: "2026-01-02T00:00:00.000Z" },
        ],
      },
    },
  }), "utf8");

  const store = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.equal((await store.listWords(CLIENT, "my-shared-a"))?.[0]?.meanings[0]?.definition, "first meaning");
  assert.equal((await store.listWords(CLIENT, "my-shared-b"))?.[0]?.meanings[0]?.definition, "second meaning");
  store.close();

  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbook_words WHERE client_id = ? AND id = ?").get(CLIENT, sharedWordId) as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_states WHERE client_id = ? AND wordbook_word_id = ?").get(CLIENT, sharedWordId) as { count: number }).count, 2);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.deepEqual(
    [(await reopened.listWords(CLIENT, "my-shared-a"))?.[0]?.level, (await reopened.listWords(CLIENT, "my-shared-b"))?.[0]?.level],
    [1, 3],
  );
  const edited = await reopened.updateWord(CLIENT, "my-shared-a", sharedWordId, {
    meanings: [{ pos: "noun", definition: "first meaning edited" }],
  });
  assert.equal(edited.kind, "updated");
  assert.equal((await reopened.listWords(CLIENT, "my-shared-a"))?.[0]?.meanings[0]?.definition, "first meaning edited");
  assert.equal((await reopened.listWords(CLIENT, "my-shared-b"))?.[0]?.meanings[0]?.definition, "second meaning");
  assert.deepEqual(
    (await reopened.batchWords(CLIENT, "my-shared-a", { action: "delete", wordIds: [sharedWordId] }))?.succeededIds,
    [sharedWordId],
  );
  assert.equal((await reopened.listWords(CLIENT, "my-shared-a"))?.length, 0);
  assert.equal((await reopened.listWords(CLIENT, "my-shared-b"))?.length, 1);
  reopened.close();
});

test("normalized rows preserve client-scoped legacy id collisions and merge them safely", async (t) => {
  const files = await fixture(t);
  const collisionClient = (definition: string) => ({
    favorites: [],
    events: [],
    drafts: [],
    wordbooks: [{
      id: "my-collision",
      title: definition,
      description: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      words: [{ ...entry("shared", definition), id: "word-collision", addedAt: "2026-01-01T00:00:00.000Z" }],
    }],
    studyRounds: [{
      id: "round-collision",
      wordbookId: "my-collision",
      mode: "new",
      scope: "standard",
      meaningPreference: "en",
      exerciseTypes: ["self-rating"],
      wordIds: ["word-collision"],
      queue: [{ id: "task-collision", wordId: "word-collision", exercise: "self-rating" }],
      passedTaskKeys: [],
      completedWordIds: [],
      masteredWordIds: [],
      vagueWordIds: [],
      unknownWordIds: [],
      processedOperationIds: [],
      revision: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }],
  });
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 6,
    catalog: [],
    revisions: [],
    contributions: [],
    users: [],
    userAvatars: {},
    sessions: [],
    clients: {
      "collision-client-a": collisionClient("first meaning"),
      "collision-client-b": collisionClient("second meaning"),
    },
  }), "utf8");

  const store = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.equal((await store.listWords("collision-client-a", "my-collision"))?.[0]?.meanings[0]?.definition, "first meaning");
  assert.equal((await store.listWords("collision-client-b", "my-collision"))?.[0]?.meanings[0]?.definition, "second meaning");
  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbooks WHERE id = 'my-collision'").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM wordbook_words WHERE id = 'word-collision'").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_rounds WHERE id = 'round-collision'").get() as { count: number }).count, 2);
  db.close();

  await store.mergeClients("collision-client-a", "collision-client-b");
  const merged = await store.listMyWordbooks("collision-client-b", false);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((book) => book.id)).size, 2);
  store.close();
  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.equal((await reopened.listMyWordbooks("collision-client-b", false)).length, 2);
  assert.equal((await reopened.listMyWordbooks("collision-client-a", false)).length, 0);
  reopened.close();
});

test("concurrent stores retry stale event transitions without losing events or projections", async (t) => {
  const files = await fixture(t);
  const seed = new SqliteStudyStore(files.databaseFile);
  const created = await seed.createMyWordbook(CLIENT, { title: "Concurrent events", words: [entry("concurrent")] });
  const word = (await seed.listWords(CLIENT, created.id))![0]!;
  seed.close();

  const barrier = new SaveBarrier();
  const later = new BarrierSqliteStudyStore(files.databaseFile, barrier, () => new Date("2026-04-02T00:00:00.000Z"));
  const earlier = new BarrierSqliteStudyStore(files.databaseFile, barrier, () => new Date("2026-04-01T00:00:00.000Z"));
  const [laterEvent, earlierEvent] = await Promise.all([
    later.recordEvent(CLIENT, { kind: "mark", wordbookId: created.id, wordId: word.id, level: 4 }),
    earlier.recordEvent(CLIENT, { kind: "mark", wordbookId: created.id, wordId: word.id, level: 2 }),
  ]);
  assert.ok(laterEvent);
  assert.ok(earlierEvent);
  later.close();
  earlier.close();

  const db = new Database(files.databaseFile, { readonly: true });
  assert.deepEqual(
    (db.prepare("SELECT sequence FROM study_events ORDER BY sequence").all() as Array<{ sequence: number }>).map((row) => row.sequence),
    [0, 1],
  );
  assert.equal((db.prepare("SELECT level FROM study_states WHERE client_id = ? AND wordbook_id = ? AND wordbook_word_id = ?").get(CLIENT, created.id, word.id) as { level: number }).level, 4);
  db.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.equal((await reopened.listWords(CLIENT, created.id))?.[0]?.level, 4);
  assert.equal((await reopened.getDashboard(CLIENT, created.id))?.recentActivity.length, 2);
  reopened.close();
});

test("concurrent answers cannot both commit the same round revision", async (t) => {
  const files = await fixture(t);
  const seed = new SqliteStudyStore(files.databaseFile);
  const created = await seed.createMyWordbook(CLIENT, { title: "Concurrent answers", words: [entry("answer")] });
  await seed.updateMyWordbook(CLIENT, created.id, { studyPreferences: selfRatingPreferences(1) });
  const started = await seed.startStudyRound(CLIENT, { wordbookId: created.id, mode: "new" });
  assert.ok(started?.round.queue[0]);
  seed.close();

  const barrier = new SaveBarrier();
  const first = new BarrierSqliteStudyStore(files.databaseFile, barrier, () => new Date("2026-05-01T00:00:00.000Z"));
  const second = new BarrierSqliteStudyStore(files.databaseFile, barrier, () => new Date("2026-05-01T00:00:00.000Z"));
  const common = { taskId: started!.round.queue[0]!.id, response: "vague" as const, revision: started!.round.revision };
  const results = await Promise.all([
    first.answerStudyRound(CLIENT, started!.round.id, { ...common, operationId: "concurrent-operation-a" }),
    second.answerStudyRound(CLIENT, started!.round.id, { ...common, operationId: "concurrent-operation-b" }),
  ]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ["conflict", "updated"]);
  first.close();
  second.close();

  const db = new Database(files.databaseFile, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_round_operations WHERE client_id = ? AND round_id = ?").get(CLIENT, started!.round.id) as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM study_events WHERE client_id = ?").get(CLIENT) as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT revision FROM study_rounds WHERE client_id = ? AND id = ?").get(CLIENT, started!.round.id) as { revision: number }).revision, 1);
  db.close();
});

test("SQLite reloads normalized private rows written by another store instance", async (t) => {
  const files = await fixture(t);
  const reader = new SqliteStudyStore(files.databaseFile);
  const writer = new SqliteStudyStore(files.databaseFile);
  assert.deepEqual(await reader.listMyWordbooks(CLIENT, false), []);
  const created = await writer.createMyWordbook(CLIENT, { title: "External normalized write", words: [entry("sync")] });
  assert.equal((await reader.listWords(CLIENT, created.id))?.[0]?.word, "sync");
  reader.close();
  writer.close();
});

test("engagement writes do not invalidate the cached study state", async (t) => {
  const files = await fixture(t);
  const reader = new CountingSqliteStudyStore(files.databaseFile);
  const writer = new SqliteStudyStore(files.databaseFile);
  const engagement = new SqliteEngagementStore(files.databaseFile);
  assert.deepEqual(await reader.listMyWordbooks(CLIENT, false), []);
  assert.equal(reader.loadCount, 1);

  await engagement.recordSearch("cache-isolation");
  assert.deepEqual(await reader.listMyWordbooks(CLIENT, false), []);
  assert.equal(reader.loadCount, 1);

  const created = await writer.createMyWordbook(CLIENT, { title: "Generation invalidation", words: [entry("generation")] });
  assert.equal((await reader.listWords(CLIENT, created.id))?.[0]?.word, "generation");
  assert.equal(reader.loadCount, 2);
  reader.close();
  writer.close();
  engagement.close();
});
