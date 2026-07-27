import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { BaseStore } from "./store.js";
import { EMPTY, migrate, type ClientData, type State } from "./ladder.js";
import type { AccountUser, CatalogWordbook } from "./types.js";

type SqliteStoreOptions = {
  now?: () => Date;
  /** Existing JSON document imported exactly once when the new database is empty. */
  legacyJsonFile?: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  client_id: string;
  created_at: string;
};
type SessionRow = {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};
type JsonRow = { data_json: string };

const LEGACY_IMPORT_KEY = "legacy_json_import_v1";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keyed<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

/**
 * Hybrid persistence: account/session/catalog fields live in queryable relational
 * rows, while each learner's private collection remains one JSON row. BaseStore
 * keeps the domain semantics; save() writes only rows changed by that transition.
 */
export class SqliteStudyStore extends BaseStore {
  private readonly databaseFile: string;
  private readonly legacyJsonFile?: string;
  private database?: Database.Database;

  constructor(databaseFile: string, options: SqliteStoreOptions = {}) {
    super(options.now);
    this.databaseFile = resolve(databaseFile);
    this.legacyJsonFile = options.legacyJsonFile ? resolve(options.legacyJsonFile) : undefined;
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  protected async load(): Promise<State> {
    const db = await this.open();
    await this.importLegacyJsonIfNeeded(db);

    const clients: Record<string, ClientData> = {};
    for (const row of db.prepare("SELECT client_id, data_json FROM clients").all() as Array<{ client_id: string; data_json: string }>) {
      clients[row.client_id] = JSON.parse(row.data_json) as ClientData;
    }
    const users = (db.prepare("SELECT id, username, password_hash, client_id, created_at FROM users").all() as UserRow[])
      .map((row): AccountUser => ({
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        clientId: row.client_id,
        createdAt: row.created_at,
      }));
    const sessions = (db.prepare("SELECT token_hash, user_id, expires_at, created_at FROM sessions").all() as SessionRow[])
      .map((row) => ({
        tokenHash: row.token_hash,
        userId: row.user_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }));
    const catalog = (db.prepare("SELECT data_json FROM catalog").all() as JsonRow[])
      .map((row) => JSON.parse(row.data_json) as CatalogWordbook);

    return migrate({ version: 3, catalog, clients, users, sessions });
  }

  protected async save(state: State, previous?: State): Promise<void> {
    const db = await this.open();
    const before = previous ?? EMPTY();
    const write = db.transaction(() => {
      this.syncClients(db, before, state);
      this.syncUsers(db, before, state);
      this.syncCatalog(db, before, state);
      this.syncSessions(db, before, state);
    });
    write();
  }

  private async open(): Promise<Database.Database> {
    if (this.database?.open) return this.database;
    await mkdir(dirname(this.databaseFile), { recursive: true });
    const db = new Database(this.databaseFile);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    this.createSchema(db);
    this.database = db;
    return db;
  }

  private createSchema(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        client_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS catalog (
        id TEXT PRIMARY KEY,
        owner_client_id TEXT,
        author_user_id TEXT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted', 'private')),
        created_at TEXT NOT NULL,
        uses INTEGER NOT NULL,
        rating REAL NOT NULL,
        share_code TEXT NOT NULL UNIQUE,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS catalog_visibility_created_idx ON catalog(visibility, created_at DESC);
      CREATE INDEX IF NOT EXISTS catalog_owner_idx ON catalog(owner_client_id);
      CREATE INDEX IF NOT EXISTS catalog_author_user_idx ON catalog(author_user_id);
      CREATE INDEX IF NOT EXISTS catalog_uses_idx ON catalog(uses DESC);
      CREATE INDEX IF NOT EXISTS catalog_rating_idx ON catalog(rating DESC);
    `);
  }

  private async importLegacyJsonIfNeeded(db: Database.Database): Promise<void> {
    if (db.prepare("SELECT 1 FROM metadata WHERE key = ?").get(LEGACY_IMPORT_KEY)) return;
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM clients) +
        (SELECT COUNT(*) FROM users) +
        (SELECT COUNT(*) FROM sessions) +
        (SELECT COUNT(*) FROM catalog) AS count
    `).get() as { count: number };

    let legacy: State | null = null;
    if (counts.count === 0 && this.legacyJsonFile) {
      try {
        legacy = migrate(JSON.parse(await readFile(this.legacyJsonFile, "utf8")) as unknown);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
    }

    const importOnce = db.transaction(() => {
      if (legacy) {
        const empty = EMPTY();
        this.syncClients(db, empty, legacy);
        this.syncUsers(db, empty, legacy);
        this.syncCatalog(db, empty, legacy);
        this.syncSessions(db, empty, legacy);
      }
      db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run(
        LEGACY_IMPORT_KEY,
        legacy ? "imported" : counts.count === 0 ? "no-source" : "skipped-nonempty",
      );
      db.prepare("INSERT INTO metadata(key, value) VALUES ('state_version', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    });
    importOnce();
  }

  private syncClients(db: Database.Database, before: State, after: State): void {
    const upsert = db.prepare("INSERT INTO clients(client_id, data_json) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET data_json = excluded.data_json");
    const remove = db.prepare("DELETE FROM clients WHERE client_id = ?");
    for (const [id, value] of Object.entries(after.clients)) {
      if (!same(before.clients[id], value)) upsert.run(id, JSON.stringify(value));
    }
    for (const id of Object.keys(before.clients)) if (!(id in after.clients)) remove.run(id);
  }

  private syncUsers(db: Database.Database, before: State, after: State): void {
    const old = keyed(before.users, (user) => user.id);
    const current = keyed(after.users, (user) => user.id);
    const upsert = db.prepare(`
      INSERT INTO users(id, username, password_hash, client_id, created_at)
      VALUES (@id, @username, @passwordHash, @clientId, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        client_id = excluded.client_id,
        created_at = excluded.created_at
    `);
    const remove = db.prepare("DELETE FROM users WHERE id = ?");
    for (const user of after.users) if (!same(old.get(user.id), user)) upsert.run(user);
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }

  private syncSessions(db: Database.Database, before: State, after: State): void {
    const old = keyed(before.sessions, (session) => session.tokenHash);
    const current = keyed(after.sessions, (session) => session.tokenHash);
    const upsert = db.prepare(`
      INSERT INTO sessions(token_hash, user_id, expires_at, created_at)
      VALUES (@tokenHash, @userId, @expiresAt, @createdAt)
      ON CONFLICT(token_hash) DO UPDATE SET
        user_id = excluded.user_id,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `);
    const remove = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
    for (const session of after.sessions) if (!same(old.get(session.tokenHash), session)) upsert.run(session);
    for (const tokenHash of old.keys()) if (!current.has(tokenHash)) remove.run(tokenHash);
  }

  private syncCatalog(db: Database.Database, before: State, after: State): void {
    const old = keyed(before.catalog, (book) => book.id);
    const current = keyed(after.catalog, (book) => book.id);
    const upsert = db.prepare(`
      INSERT INTO catalog(
        id, owner_client_id, author_user_id, title, author, visibility,
        created_at, uses, rating, share_code, data_json
      ) VALUES (
        @id, @ownerClientId, @authorUserId, @title, @author, @visibility,
        @createdAt, @uses, @rating, @shareCode, @dataJson
      )
      ON CONFLICT(id) DO UPDATE SET
        owner_client_id = excluded.owner_client_id,
        author_user_id = excluded.author_user_id,
        title = excluded.title,
        author = excluded.author,
        visibility = excluded.visibility,
        created_at = excluded.created_at,
        uses = excluded.uses,
        rating = excluded.rating,
        share_code = excluded.share_code,
        data_json = excluded.data_json
    `);
    const remove = db.prepare("DELETE FROM catalog WHERE id = ?");
    for (const book of after.catalog) {
      if (same(old.get(book.id), book)) continue;
      upsert.run({
        id: book.id,
        ownerClientId: book.ownerClientId ?? null,
        authorUserId: book.authorUserId ?? null,
        title: book.title,
        author: book.author,
        visibility: book.visibility,
        createdAt: book.createdAt,
        uses: book.uses,
        rating: book.rating,
        shareCode: book.shareCode,
        dataJson: JSON.stringify(book),
      });
    }
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }
}
