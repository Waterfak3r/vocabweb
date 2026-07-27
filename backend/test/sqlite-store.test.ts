import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { SqliteStudyStore } from "../src/study/sqlite-store.js";

const CLIENT = "client-sqlite-0001";

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

test("SQLite persists only the changed client row for a private collection mutation", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile);
  await store.createMyWordbook(CLIENT, { title: "First" });

  const inspection = new Database(files.databaseFile);
  inspection.exec(`
    CREATE TABLE write_audit(table_name TEXT NOT NULL, action TEXT NOT NULL);
    CREATE TRIGGER audit_clients_insert AFTER INSERT ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'insert'); END;
    CREATE TRIGGER audit_clients_update AFTER UPDATE ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'update'); END;
    CREATE TRIGGER audit_clients_delete AFTER DELETE ON clients BEGIN INSERT INTO write_audit VALUES ('clients', 'delete'); END;
    CREATE TRIGGER audit_users_update AFTER UPDATE ON users BEGIN INSERT INTO write_audit VALUES ('users', 'update'); END;
    CREATE TRIGGER audit_sessions_update AFTER UPDATE ON sessions BEGIN INSERT INTO write_audit VALUES ('sessions', 'update'); END;
    CREATE TRIGGER audit_catalog_update AFTER UPDATE ON catalog BEGIN INSERT INTO write_audit VALUES ('catalog', 'update'); END;
  `);

  await store.createMyWordbook(CLIENT, { title: "Second" });
  assert.deepEqual(
    inspection.prepare("SELECT table_name, action FROM write_audit").all(),
    [{ table_name: "clients", action: "update" }],
  );
  assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM clients").get() as { count: number }).count, 1);
  inspection.close();
  store.close();
});

test("SQLite exposes constrained, queryable user/session/catalog rows", async (t) => {
  const files = await fixture(t);
  const store = new SqliteStudyStore(files.databaseFile, { now: () => new Date("2026-07-27T00:00:00.000Z") });

  const created = await store.createUser("Learner", "scrypt:test-hash", CLIENT);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  await store.createSession("token-hash", created.user.id, "2026-08-27T00:00:00.000Z");
  const privateBook = await store.createMyWordbook(CLIENT, { title: "Queryable" });
  const catalog = await store.uploadCatalog(CLIENT, {
    sourceWordbookId: privateBook.id,
    visibility: "private",
    author: { userId: created.user.id, username: created.user.username },
  });
  assert.ok(catalog);

  const inspection = new Database(files.databaseFile);
  assert.deepEqual(
    inspection.prepare("SELECT username, client_id FROM users").get(),
    { username: "Learner", client_id: CLIENT },
  );
  assert.deepEqual(
    inspection.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?").get("token-hash"),
    { user_id: created.user.id, expires_at: "2026-08-27T00:00:00.000Z" },
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
