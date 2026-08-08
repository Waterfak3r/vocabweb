import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { SqliteStudyStore } from "../src/study/sqlite-store.js";
import type { WordbookStudyPreferences } from "../src/study/types.js";

const CLIENT = "client-sqlite-0001";
const AVATAR_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "vacab-sqlite-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return {
    directory,
    databaseFile: path.join(directory, "study.sqlite"),
    legacyJsonFile: path.join(directory, "study-state.json"),
  };
}

test("SQLite imports a legacy JSON document once when the database is empty", async (t) => {
  const files = await fixture(t);
  await writeFile(files.legacyJsonFile, JSON.stringify({
    version: 2,
    catalog: [],
    clients: {
      [CLIENT]: {
        favorites: [],
        events: [],
        drafts: [],
        wordbooks: [{
          id: "my-legacy",
          title: "Legacy words",
          description: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          words: [],
        }],
      },
    },
  }), "utf8");

  const first = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.deepEqual((await first.listMyWordbooks(CLIENT, false)).map((book) => book.title), ["Legacy words"]);
  first.close();

  // Changing the legacy source after the import must not replay or replace it.
  const changed = JSON.parse(await readFile(files.legacyJsonFile, "utf8")) as { clients: Record<string, unknown> };
  changed.clients[CLIENT] = { favorites: [], events: [], drafts: [], wordbooks: [] };
  await writeFile(files.legacyJsonFile, JSON.stringify(changed), "utf8");

  const reopened = new SqliteStudyStore(files.databaseFile, { legacyJsonFile: files.legacyJsonFile });
  assert.deepEqual((await reopened.listMyWordbooks(CLIENT, false)).map((book) => book.title), ["Legacy words"]);
  reopened.close();

  const inspection = new Database(files.databaseFile, { readonly: true });
  assert.equal(
    (inspection.prepare("SELECT value FROM metadata WHERE key = 'legacy_json_import_v1'").get() as { value: string }).value,
    "imported",
  );
  inspection.close();
});

test("SQLite persists only the new wordbook row for a private collection mutation", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  await store.createMyWordbook(CLIENT, { title: "First" });

  const inspection = new Database(files.databaseFile);
  inspection.exec(`
    CREATE TABLE write_audit(table_name TEXT NOT NULL, action TEXT NOT NULL);
    CREATE TRIGGER audit_clients_insert AFTER INSERT ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'insert'); END;
    CREATE TRIGGER audit_clients_update AFTER UPDATE ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'update'); END;
    CREATE TRIGGER audit_clients_delete AFTER DELETE ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'delete'); END;
    CREATE TRIGGER audit_wordbooks_insert AFTER INSERT ON wordbooks BEGIN INSERT INTO write_audit VALUES ('wordbooks', 'insert'); END;
    CREATE TRIGGER audit_wordbooks_update AFTER UPDATE ON wordbooks BEGIN INSERT INTO write_audit VALUES ('wordbooks', 'update'); END;
    CREATE TRIGGER audit_users_update AFTER UPDATE ON users BEGIN INSERT INTO write_audit VALUES ('users', 'update'); END;
    CREATE TRIGGER audit_sessions_update AFTER UPDATE ON sessions BEGIN INSERT INTO write_audit VALUES ('sessions', 'update'); END;
    CREATE TRIGGER audit_catalog_update AFTER UPDATE ON catalog BEGIN INSERT INTO write_audit VALUES ('catalog', 'update'); END;
  `);

  await store.createMyWordbook(CLIENT, { title: "Second" });
  assert.deepEqual(
    inspection.prepare("SELECT table_name, action FROM write_audit").all(),
    [{ table_name: "wordbooks", action: "insert" }],
  );
  assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM clients").get() as { count: number }).count, 1);
  assert.equal((inspection.prepare("SELECT data_json FROM clients").get() as { data_json: string }).data_json, "{}");
  inspection.close();
  store.close();
});

test("SQLite durably reloads synchronized wordbook and global study settings", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  const book = await store.createMyWordbook(CLIENT, { title: "Settings" });
  const preferences: WordbookStudyPreferences = {
    plan: { newWords: 24, dictation: 16, backlogReviews: 50 },
    modes: {
      new: { meaningPreference: "zh", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating", "meaning-choice"] },
      review: { meaningPreference: "en", showExamples: true, showPhonetic: false, autoPlayAudio: true, exerciseTypes: ["self-rating", "meaning-choice"] },
      dictation: {
        meaningPreference: "zh",
        showExamples: false,
        showPhonetic: false,
        autoPlayAudio: true,
        underlineMistakes: true,
        showMeaning: true,
        showCharacterMask: false,
      },
    },
  };
  await store.updateMyWordbook(CLIENT, book.id, { studyPreferences: preferences });
  await store.updateStudySettings(CLIENT, {
    pronunciation: { accent: "us" },
    shortcuts: { unknown: "a", vague: "s", pronounce: "enter", known: "d", mastered: "r", flip: " ", dictationPronounce: "tab" },
  });
  store.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  assert.deepEqual((await reopened.getMyWordbook(CLIENT, book.id))?.studyPreferences, preferences);
  assert.deepEqual((await reopened.getStudySettings(CLIENT))?.pronunciation, { accent: "us" });
  assert.equal((await reopened.getStudySettings(CLIENT))?.shortcuts.unknown, "a");
  reopened.close();
});

test("SQLite persists round queues as rows and derives the current word after reopening", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  const book = await store.createMyWordbook(CLIENT, {
    title: "Round view",
    words: [{
      word: "resilient",
      phonetic: "/rɪˈzɪliənt/",
      source: "user",
      meanings: [{ pos: "adjective", definition: "able to recover" }],
    }],
  });
  const started = await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "new" });
  assert.ok(started?.round.currentWord);
  const roundId = started.round.id;
  store.close();

  const inspection = new Database(files.databaseFile, { readonly: true });
  assert.deepEqual(
    inspection.prepare("SELECT id, wordbook_id, revision FROM study_rounds WHERE client_id = ?").get(CLIENT),
    { id: roundId, wordbook_id: book.id, revision: 0 },
  );
  assert.equal(
    (inspection.prepare("SELECT COUNT(*) AS count FROM study_round_tasks WHERE round_id = ?").get(roundId) as { count: number }).count,
    started.round.queue.length,
  );
  assert.equal((inspection.prepare("SELECT data_json FROM clients WHERE client_id = ?").get(CLIENT) as { data_json: string }).data_json, "{}");
  inspection.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  const restored = await reopened.getStudyRound(CLIENT, roundId);
  assert.equal(restored?.currentWord?.word, "resilient");
  assert.equal(restored?.currentWord?.id, restored?.queue[0]?.wordId);
  reopened.close();
});

test("SQLite exposes constrained, queryable user/session/catalog rows", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile, { now: () => new Date("2026-07-27T00:00:00.000Z") });

  const created = await store.createUser("Learner", "scrypt:test-hash", CLIENT);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  await store.createSession("token-hash", created.user.id, "2026-08-27T00:00:00.000Z");
  await store.createSession("other-token-hash", created.user.id, "2026-08-27T00:00:00.000Z");
  const privateBook = await store.createMyWordbook(CLIENT, { title: "Queryable" });
  const catalog = await store.uploadCatalog(CLIENT, {
    sourceWordbookId: privateBook.id,
    visibility: "private",
    author: { userId: created.user.id, username: created.user.username },
  });
  assert.ok(catalog);

  const inspection = new Database(files.databaseFile);
  assert.deepEqual(
    inspection.prepare("SELECT username, client_id, role FROM users").get(),
    { username: "Learner", client_id: CLIENT, role: "user" },
  );
  assert.deepEqual(
    inspection.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get("token-hash"),
    { user_id: created.user.id, expires_at: "2026-08-27T00:00:00.000Z" },
  );
  assert.equal(
    (await store.updateUserPassword(created.user.id, "scrypt:updated-hash", "token-hash"))?.passwordHash,
    "scrypt:updated-hash",
  );
  assert.deepEqual(
    inspection.prepare("SELECT password_hash FROM users WHERE id = ?").get(created.user.id),
    { password_hash: "scrypt:updated-hash" },
  );
  assert.deepEqual(
    inspection.prepare("SELECT token_hash FROM sessions ORDER BY token_hash").all(),
    [{ token_hash: "token-hash" }],
  );
  assert.deepEqual(
    inspection.prepare("SELECT owner_client_id, author_user_id, visibility, title FROM catalog").get(),
    {
      owner_client_id: CLIENT,
      author_user_id: created.user.id,
      visibility: "private",
      title: "Queryable",
    },
  );
  assert.throws(
    () => inspection.prepare("INSERT INTO users(id, username, password_hash, client_id, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "user-duplicate",
      "learner",
      "hash",
      "client-sqlite-0002",
      "2026-07-27T00:00:00.000Z",
    ),
    /UNIQUE constraint failed/,
  );
  inspection.close();
  store.close();
});

test("SQLite persists v6 revisions and contributions with indexes and catalog cascades", async (t) => {
  const files = await fixture(t);
  const publisherClient = "client-sqlite-publisher";
  const contributorClient = "client-sqlite-contributor";
  const store = new SqliteStudyStore(files.databaseFile);
  const publisherResult = await store.createUser("Publisher", "hash", publisherClient);
  const contributorResult = await store.createUser("Contributor", "hash", contributorClient);
  assert.equal(publisherResult.kind, "created");
  assert.equal(contributorResult.kind, "created");
  if (publisherResult.kind !== "created" || contributorResult.kind !== "created") return;
  const publisher = { userId: publisherResult.user.id, username: publisherResult.user.username };
  const contributor = { userId: contributorResult.user.id, username: contributorResult.user.username };
  const source = await store.createMyWordbook(publisherClient, {
    title: "Versioned",
    words: [{
      word: "alpha",
      phonetic: "/alpha/",
      meanings: [{ pos: "noun", definition: "alpha" }],
      source: "user",
      zhMeaning: "甲",
      zhMeaningSource: "user",
    }],
  });
  const catalog = await store.uploadCatalog(publisherClient, {
    sourceWordbookId: source.id,
    visibility: "public",
    author: publisher,
  });
  assert.ok(catalog);
  const joined = await store.addCatalogToMine(contributorClient, catalog.id);
  assert.ok(joined);
  const words = await store.listWords(contributorClient, joined.wordbook.id);
  await store.updateWord(contributorClient, joined.wordbook.id, words![0]!.id, { zhMeaning: "改进后的甲" });
  const preview = await store.getContributionPreview(contributorClient, contributor.userId, joined.wordbook.id);
  assert.ok(preview);
  const created = await store.createContribution(contributorClient, contributor, catalog.id, {
    title: "完善释义",
    expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
    expectedHeadRevisionId: preview.expectedHeadRevisionId,
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  assert.equal((await store.mergeContribution(publisherClient, publisher, catalog.id, created.contribution.id, {})).kind, "updated");
  store.close();

  const reopened = new SqliteStudyStore(files.databaseFile);
  const revisions = await reopened.listCatalogRevisions(publisherClient, publisher.userId, catalog.id, {});
  const contributions = await reopened.listCatalogContributions(publisherClient, publisher.userId, catalog.id, {});
  assert.deepEqual(revisions?.items.map((revision) => revision.kind).sort(), ["initial", "merge"]);
  assert.deepEqual(contributions?.items.map((contribution) => contribution.status), ["merged"]);
  reopened.close();

  const inspection = new Database(files.databaseFile);
  const revisionIndexes = (inspection.prepare("PRAGMA index_list(catalog_revisions)").all() as Array<{ name: string }>).map((index) => index.name);
  const contributionIndexes = (inspection.prepare("PRAGMA index_list(catalog_contributions)").all() as Array<{ name: string }>).map((index) => index.name);
  assert.ok(revisionIndexes.includes("catalog_revisions_catalog_created_idx"));
  assert.ok(contributionIndexes.includes("catalog_contributions_catalog_status_idx"));
  assert.ok(contributionIndexes.includes("catalog_contributions_contributor_status_idx"));
  inspection.close();

  const deleting = new SqliteStudyStore(files.databaseFile);
  assert.equal(await deleting.deleteCatalogUpload(publisherClient, catalog.id), true);
  deleting.close();
  const afterDelete = new Database(files.databaseFile, { readonly: true });
  assert.equal((afterDelete.prepare("SELECT COUNT(*) AS count FROM catalog_revisions").get() as { count: number }).count, 0);
  assert.equal((afterDelete.prepare("SELECT COUNT(*) AS count FROM catalog_contributions").get() as { count: number }).count, 0);
  afterDelete.close();
});

test("SQLite reloads cached account state after an external administrator update", async (t) => {
  const files = await fixture(t);
  const serverStore = new SqliteStudyStore(files.databaseFile);
  const adminStore = new SqliteStudyStore(files.databaseFile);

  try {
    const created = await serverStore.createUser("Operator", "scrypt:test-hash", CLIENT);
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    await serverStore.createSession(
      "operator-session",
      created.user.id,
      "2026-08-27T00:00:00.000Z",
    );
    assert.equal((await serverStore.getUserByUsername("Operator"))?.role, "user");

    assert.equal((await adminStore.setUserRole("Operator", "admin"))?.role, "admin");
    assert.equal((await serverStore.getUserByUsername("Operator"))?.role, "admin");
    assert.equal(
      (await serverStore.getSession(
        "operator-session",
        new Date("2026-07-29T00:00:00.000Z"),
      ))?.user.role,
      "admin",
    );
  } finally {
    serverStore.close();
    adminStore.close();
  }
});

test("SQLite reads avatar BLOBs lazily and refreshes account metadata across store instances", async (t) => {
  const files = await fixture(t);
  const serverStore = new SqliteStudyStore(files.databaseFile, { now: () => new Date("2026-08-08T08:00:00.000Z") });
  const writerStore = new SqliteStudyStore(files.databaseFile, { now: () => new Date("2026-08-08T08:01:00.000Z") });
  try {
    const created = await serverStore.createUser("AvatarOwner", "scrypt:test-hash", CLIENT);
    assert.equal(created.kind, "created");
    if (created.kind !== "created") return;
    await serverStore.createSession("avatar-session", created.user.id, "2026-09-08T00:00:00.000Z");
    const first = await serverStore.setUserAvatar(created.user.id, {
      mimeType: "image/png",
      dataBase64: AVATAR_BYTES.toString("base64"),
    });
    assert.ok(first?.avatarVersion);
    assert.deepEqual((await serverStore.getUserAvatar(created.user.id))?.dataBase64, AVATAR_BYTES.toString("base64"));
    assert.equal(
      (await serverStore.getSession("avatar-session", new Date("2026-08-08T08:00:30.000Z")))?.user.avatarVersion,
      first?.avatarVersion,
    );

    const replaced = await writerStore.setUserAvatar(created.user.id, {
      mimeType: "image/jpeg",
      dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xdb]).toString("base64"),
    });
    assert.notEqual(replaced?.avatarVersion, first?.avatarVersion);
    assert.equal(
      (await serverStore.getSession("avatar-session", new Date("2026-08-08T08:01:30.000Z")))?.user.avatarVersion,
      replaced?.avatarVersion,
    );

    const inspection = new Database(files.databaseFile, { readonly: true });
    assert.deepEqual(
      inspection.prepare("SELECT typeof(data) AS storage, length(data) AS bytes FROM user_avatars WHERE user_id = ?").get(created.user.id),
      { storage: "blob", bytes: 4 },
    );
    inspection.close();

    assert.equal(await serverStore.deleteUser(created.user.id), true);
    const afterDelete = new Database(files.databaseFile, { readonly: true });
    assert.equal((afterDelete.prepare("SELECT COUNT(*) AS count FROM user_avatars").get() as { count: number }).count, 0);
    afterDelete.close();
  } finally {
    serverStore.close();
    writerStore.close();
  }
});

test("SQLite adds a safe user role to databases created before role authorization", async (t) => {
  const files = await fixture(t);
  const legacy = new Database(files.databaseFile);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      client_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    INSERT INTO users VALUES (
      'user-legacy', 'Waterfak3r', 'scrypt:test-hash',
      'client-legacy-0001', '2026-07-27T00:00:00.000Z'
    );
  `);
  legacy.close();

  const store = new SqliteStudyStore(files.databaseFile);
  const user = await store.getUserByUsername("Waterfak3r");
  assert.equal(user?.role, "user");
  assert.equal((await store.setUserRole("Waterfak3r", "admin"))?.role, "admin");
  assert.ok((await store.setUserAvatar("user-legacy", {
    mimeType: "image/png",
    dataBase64: AVATAR_BYTES.toString("base64"),
  }))?.avatarVersion);
  store.close();

  const inspection = new Database(files.databaseFile, { readonly: true });
  assert.deepEqual(
    inspection.prepare("SELECT role, (SELECT COUNT(*) FROM user_avatars) AS avatars FROM users WHERE id = 'user-legacy'").get(),
    { role: "admin", avatars: 1 },
  );
  inspection.close();
});

test("SQLite online backups are complete and pass integrity checks", async (t) => {
  const files = await fixture(t);
  const backupFile = path.join(files.directory, "backup", "study.sqlite");
  const store = new SqliteStudyStore(files.databaseFile);
  const wordbook = await store.createMyWordbook(CLIENT, {
    title: "Backed up",
    words: [{ word: "durable", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "able to last" }] }],
  });
  const round = await store.startStudyRound(CLIENT, { wordbookId: wordbook.id, mode: "new" });
  assert.ok(round?.round.queue[0]);
  const answered = await store.answerStudyRound(CLIENT, round!.round.id, {
    taskId: round!.round.queue[0]!.id,
    response: "vague",
    operationId: "backup-operation",
    revision: round!.round.revision,
  });
  assert.equal(answered.kind, "updated");
  const user = await store.createUser("BackupAvatar", "hash", CLIENT);
  assert.equal(user.kind, "created");
  if (user.kind !== "created") return;
  await store.setUserAvatar(user.user.id, { mimeType: "image/png", dataBase64: AVATAR_BYTES.toString("base64") });
  await store.checkHealth();
  await store.backup(backupFile);
  store.close();

  const backup = new SqliteStudyStore(backupFile);
  assert.deepEqual((await backup.listMyWordbooks(CLIENT, false)).map((book) => book.title), ["Backed up"]);
  assert.equal((await backup.getStudyRound(CLIENT, round!.round.id))?.processedOperationIds[0], "backup-operation");
  assert.equal((await backup.getDashboard(CLIENT, wordbook.id))?.recentActivity.length, 1);
  assert.equal((await backup.getUserAvatar(user.user.id))?.dataBase64, AVATAR_BYTES.toString("base64"));
  await backup.checkHealth();
  backup.close();

  const inspection = new Database(backupFile, { readonly: true });
  assert.deepEqual(inspection.pragma("foreign_key_check"), []);
  assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM study_events").get() as { count: number }).count, 1);
  assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM study_states").get() as { count: number }).count, 1);
  assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM study_round_tasks").get() as { count: number }).count, 2);
  inspection.close();
});
