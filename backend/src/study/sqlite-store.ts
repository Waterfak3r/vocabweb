import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { createAccountAvatar, decodeAccountAvatar } from "../account-avatar.js";
import { BaseStore, completedReviewLanes, type StudyResourceLimits, type StudyRoundSelectionContext } from "./store.js";
import { day, EMPTY, ladderEventLevels, migrate, reviewDue, reviewLane, type State, type WordLadderState } from "./ladder.js";
import {
  createPrivateStateSchema,
  loadPrivateClients,
  migrateImportDraftEntriesIfNeeded,
  migratePrivateStateIfNeeded,
  STUDY_STATE_GENERATION_KEY,
  syncPrivateClients,
} from "./sqlite-private-state.js";
import type { AccountAvatar, AccountAvatarInput, AccountUser, CatalogContribution, CatalogRevision, CatalogWordbook } from "./types.js";

type SqliteStoreOptions = {
  now?: () => Date;
  limits?: StudyResourceLimits;
  /** Existing JSON document imported exactly once when the new database is empty. */
  legacyJsonFile?: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  client_id: string;
  role: "user" | "admin";
  created_at: string;
  avatar_version: string | null;
};
type AvatarRow = { mime_type: AccountAvatar["mimeType"]; data: Buffer; version: string; updated_at: string };
type SessionRow = {
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
};
type JsonRow = { data_json: string };
type StudyStateRow = {
  wordbook_word_id: string;
  level: WordLadderState["level"];
  level_reached_at: string | null;
  last_studied_at: string | null;
  recognition_streak: WordLadderState["recognitionStreak"];
  review_interval_days: number;
  next_review_at: string | null;
  ease_factor: number;
  relearning: 0 | 1;
};

const LEGACY_IMPORT_KEY = "legacy_json_import_v1";
class StaleStudyStateError extends Error {
  constructor() {
    super("Study state changed before the transaction could commit");
    this.name = "StaleStudyStateError";
  }
}

function same(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function keyed<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

function userFromRow(row: UserRow): AccountUser {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    clientId: row.client_id,
    role: row.role,
    createdAt: row.created_at,
    ...(row.avatar_version ? { avatarVersion: row.avatar_version } : {}),
  };
}

function stateFromRow(row: StudyStateRow): WordLadderState {
  return {
    level: row.level,
    ...(row.level_reached_at ? { levelReachedAt: row.level_reached_at } : {}),
    ...(row.last_studied_at ? { lastStudiedAt: row.last_studied_at } : {}),
    recognitionStreak: row.recognition_streak,
    reviewIntervalDays: row.review_interval_days,
    ...(row.next_review_at ? { nextReviewAt: row.next_review_at } : {}),
    easeFactor: row.ease_factor,
    relearning: row.relearning === 1,
  };
}

function stateDueTimestamp(state: WordLadderState): number {
  const value = state.nextReviewAt ?? state.lastStudiedAt;
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Record-oriented SQLite persistence. BaseStore keeps the domain semantics and a
 * compatibility view in memory; private wordbooks, words, events, projections,
 * drafts, and round queues are independently addressable rows on disk.
 */
export class SqliteStudyStore extends BaseStore {
  private readonly databaseFile: string;
  private readonly legacyJsonFile?: string;
  private database?: Database.Database;
  private studyGeneration?: number;

  constructor(databaseFile: string, options: SqliteStoreOptions = {}) {
    super(options.now, options.limits);
    this.databaseFile = resolve(databaseFile);
    this.legacyJsonFile = options.legacyJsonFile ? resolve(options.legacyJsonFile) : undefined;
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.studyGeneration = undefined;
    this.clearCachedState();
  }

  async checkHealth(): Promise<void> {
    await this.serialize(async () => {
      const db = await this.open();
      // Readiness owns the one-time upgrade so traffic is not declared ready while
      // a legacy private-state document still needs a long write transaction.
      await this.importLegacyJsonIfNeeded(db);
      migratePrivateStateIfNeeded(db);
      migrateImportDraftEntriesIfNeeded(db);
      await this.refreshBeforeOperation();
      await this.warmCachedState();
      db.prepare("SELECT 1 AS ready").get();
      db.exec("BEGIN IMMEDIATE; ROLLBACK;");
    });
  }

  async backup(destinationFile: string): Promise<void> {
    const db = await this.open();
    const destination = resolve(destinationFile);
    await mkdir(dirname(destination), { recursive: true });
    await db.backup(destination);
  }

  override async getUserAvatarByVersion(version: string): Promise<AccountAvatar | null> {
    return await this.serialize(async () => {
      const db = await this.open();
      const row = db.prepare(`
        SELECT a.mime_type, a.data, a.version, a.updated_at
        FROM user_avatars a
        JOIN users u ON u.id = a.user_id
        WHERE a.version = ?
      `).get(version) as AvatarRow | undefined;
      if (!row) return null;
      const avatar: AccountAvatar = {
        mimeType: row.mime_type,
        dataBase64: row.data.toString("base64"),
        version: row.version,
        updatedAt: row.updated_at,
      };
      return decodeAccountAvatar(avatar) ? avatar : null;
    });
  }

  override async getUserAvatar(userId: string): Promise<AccountAvatar | null> {
    return await this.serialize(async () => {
      const db = await this.open();
      const row = db.prepare(`
        SELECT mime_type, data, version, updated_at
        FROM user_avatars
        WHERE user_id = ?
      `).get(userId) as AvatarRow | undefined;
      if (!row) return null;
      const avatar: AccountAvatar = {
        mimeType: row.mime_type,
        dataBase64: row.data.toString("base64"),
        version: row.version,
        updatedAt: row.updated_at,
      };
      return decodeAccountAvatar(avatar) ? avatar : null;
    });
  }

  override async setUserAvatar(userId: string, input: AccountAvatarInput | null): Promise<AccountUser | null> {
    return await this.serialize(async () => {
      const db = await this.open();
      const row = db.prepare(`
        SELECT u.id, u.username, u.password_hash, u.client_id, u.role, u.created_at,
               a.version AS avatar_version
        FROM users u
        LEFT JOIN user_avatars a ON a.user_id = u.id
        WHERE u.id = ?
      `).get(userId) as UserRow | undefined;
      if (!row) return null;
      let avatarVersion: string | null = null;
      const avatar = input ? createAccountAvatar(input, this.now().toISOString()) : null;
      const bytes = avatar ? decodeAccountAvatar(avatar) : null;
      if (avatar && !bytes) throw new Error("Account avatar payload is invalid");
      let nextGeneration = this.readStudyGeneration(db);
      const write = db.transaction(() => {
        if (avatar && bytes) {
          db.prepare(`
            INSERT INTO user_avatars(user_id, mime_type, data, version, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              mime_type = excluded.mime_type,
              data = excluded.data,
              version = excluded.version,
              updated_at = excluded.updated_at
          `).run(userId, avatar.mimeType, bytes, avatar.version, avatar.updatedAt);
          avatarVersion = avatar.version;
        } else {
          db.prepare("DELETE FROM user_avatars WHERE user_id = ?").run(userId);
        }
        nextGeneration = this.bumpStudyGeneration(db);
      });
      write.immediate();
      this.studyGeneration = nextGeneration;
      this.clearCachedState();
      return userFromRow({ ...row, avatar_version: avatarVersion });
    });
  }

  override async exportUserData(userId: string): Promise<unknown | null> {
    const exported = await super.exportUserData(userId);
    if (!exported || typeof exported !== "object") return exported;
    const avatar = await this.getUserAvatar(userId);
    if (avatar && "account" in exported && exported.account && typeof exported.account === "object") {
      (exported.account as Record<string, unknown>).avatar = avatar;
    }
    return exported;
  }

  protected async refreshBeforeOperation(): Promise<void> {
    const db = await this.open();
    const generation = this.readStudyGeneration(db);
    if (this.studyGeneration !== undefined && generation !== this.studyGeneration) {
      this.clearCachedState();
    }
    this.studyGeneration = generation;
  }

  protected override shouldRetryPersistenceError(error: unknown): boolean {
    return error instanceof StaleStudyStateError;
  }

  /** Select only stable wordbook-word ids; entry content stays out of queue construction. */
  protected override async selectStudyRoundWordIds(context: StudyRoundSelectionContext): Promise<string[] | null> {
    const db = await this.open();
    if (context.mode === "new") {
      const afterById = ladderEventLevels(context.events, context.schedule);
      const today = day(context.now);
      const completedToday = new Set(
        context.events
          .filter((event) => event.kind === "new" && day(new Date(event.occurredAt)) === today && afterById.get(event.id) === 1)
          .map((event) => event.wordId),
      ).size;
      const limit = context.scope === "ahead"
        ? Math.min(200, Math.max(1, context.preferences.plan.newWords))
        : Math.max(0, context.preferences.plan.newWords - completedToday);
      if (limit === 0) return [];
      return (db.prepare(`
        SELECT w.id
        FROM wordbook_words w
        LEFT JOIN study_states s
          ON s.client_id = ?
          AND s.wordbook_id = w.wordbook_id
          AND s.wordbook_word_id = w.id
        WHERE w.client_id = ?
          AND w.wordbook_id = ?
          AND w.deleted_at IS NULL
          AND COALESCE(s.level, 0) = 0
        ORDER BY w.position
        LIMIT ?
      `).all(context.clientId, context.clientId, context.wordbookId, limit) as Array<{ id: string }>).map((row) => row.id);
    }

    const columns = `
      s.wordbook_word_id, s.level, s.level_reached_at, s.last_studied_at,
      s.recognition_streak, s.review_interval_days, s.next_review_at,
      s.ease_factor, s.relearning
    `;
    const base = `
      FROM study_states s
      JOIN wordbook_words w
        ON w.client_id = s.client_id
        AND w.id = s.wordbook_word_id
        AND w.wordbook_id = s.wordbook_id
        AND w.deleted_at IS NULL
      WHERE s.client_id = ?
        AND s.wordbook_id = ?
        AND s.level > 0
    `;
    if (context.scope === "ahead") {
      const future = db.prepare(`
        SELECT ${columns} ${base}
          AND s.next_review_at > ?
        ORDER BY s.next_review_at, w.position
        LIMIT 200
      `).all(context.clientId, context.wordbookId, context.now.toISOString()) as StudyStateRow[];
      const fallback = db.prepare(`
        SELECT ${columns} ${base}
          AND s.next_review_at IS NULL
        ORDER BY s.last_studied_at, w.position
      `).all(context.clientId, context.wordbookId) as StudyStateRow[];
      return [...future, ...fallback]
        .map((row) => ({ id: row.wordbook_word_id, state: stateFromRow(row) }))
        .filter((item) => !reviewDue(item.state, context.now, context.schedule))
        .sort((left, right) => stateDueTimestamp(left.state) - stateDueTimestamp(right.state))
        .slice(0, 200)
        .map((item) => item.id);
    }

    const due = db.prepare(`
      SELECT ${columns} ${base}
        AND s.next_review_at <= ?
      ORDER BY s.next_review_at, w.position
    `).all(context.clientId, context.wordbookId, context.now.toISOString()) as StudyStateRow[];
    const fallback = db.prepare(`
      SELECT ${columns} ${base}
        AND s.next_review_at IS NULL
      ORDER BY s.last_studied_at, w.position
    `).all(context.clientId, context.wordbookId) as StudyStateRow[];
    const lanes: Record<"protected" | "regular" | "backlog", Array<{ id: string; state: WordLadderState }>> = {
      protected: [],
      regular: [],
      backlog: [],
    };
    for (const row of [...due, ...fallback]) {
      const state = stateFromRow(row);
      const lane = reviewLane(state, context.now, context.schedule);
      if (lane) lanes[lane].push({ id: row.wordbook_word_id, state });
    }
    lanes.protected.sort((left, right) =>
      Number(right.state.relearning) - Number(left.state.relearning)
      || stateDueTimestamp(left.state) - stateDueTimestamp(right.state));
    lanes.regular.sort((left, right) => stateDueTimestamp(left.state) - stateDueTimestamp(right.state));
    lanes.backlog.sort((left, right) => stateDueTimestamp(left.state) - stateDueTimestamp(right.state));
    if (context.scope === "backlog") {
      const batchSize = Math.min(200, Math.max(50, context.preferences.plan.backlogReviews));
      return lanes.backlog.slice(0, batchSize).map((item) => item.id);
    }
    const completed = completedReviewLanes(context.events, context.schedule, day(context.now));
    const remainingBacklog = Math.max(0, context.preferences.plan.backlogReviews - completed.backlog.size);
    return [...lanes.protected, ...lanes.regular, ...lanes.backlog.slice(0, remainingBacklog)].map((item) => item.id);
  }

  protected async load(): Promise<State> {
    const db = await this.open();
    await this.importLegacyJsonIfNeeded(db);
    migratePrivateStateIfNeeded(db);
    migrateImportDraftEntriesIfNeeded(db);

    const readSnapshot = db.transaction(() => {
      const clients = loadPrivateClients(db);
      const users = (db.prepare(`
      SELECT u.id, u.username, u.password_hash, u.client_id, u.role, u.created_at,
             a.version AS avatar_version
      FROM users u
      LEFT JOIN user_avatars a ON a.user_id = u.id
      `).all() as UserRow[]).map(userFromRow);
      const sessions = (db.prepare("SELECT token_hash, user_id, expires_at, created_at FROM sessions").all() as SessionRow[])
        .map((row) => ({
          tokenHash: row.token_hash,
          userId: row.user_id,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        }));
      const catalog = (db.prepare("SELECT data_json FROM catalog").all() as JsonRow[])
        .map((row) => JSON.parse(row.data_json) as CatalogWordbook);
      const revisions = (db.prepare("SELECT data_json FROM catalog_revisions").all() as JsonRow[])
        .map((row) => JSON.parse(row.data_json) as CatalogRevision);
      const contributions = (db.prepare("SELECT data_json FROM catalog_contributions").all() as JsonRow[])
        .map((row) => JSON.parse(row.data_json) as CatalogContribution);

      return migrate({ version: 6, catalog, revisions, contributions, clients, users, userAvatars: {}, sessions });
    });
    return readSnapshot();
  }

  protected async save(state: State, previous?: State): Promise<void> {
    const db = await this.open();
    const before = previous ?? EMPTY();
    const expectedGeneration = this.studyGeneration ?? this.readStudyGeneration(db);
    let nextGeneration: number | undefined;
    const write = db.transaction(() => {
      if (this.readStudyGeneration(db) !== expectedGeneration) throw new StaleStudyStateError();
      const changesBefore = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
      if (before.clients !== state.clients) syncPrivateClients(db, before, state);
      if (before.users !== state.users) this.syncUsers(db, before, state);
      if (before.catalog !== state.catalog) this.syncCatalog(db, before, state);
      if (before.revisions !== state.revisions) this.syncRevisions(db, before, state);
      if (before.contributions !== state.contributions) this.syncContributions(db, before, state);
      if (before.sessions !== state.sessions) this.syncSessions(db, before, state);
      const changesAfter = (db.prepare("SELECT total_changes() AS count").get() as { count: number }).count;
      if (changesAfter > changesBefore) nextGeneration = this.bumpStudyGeneration(db);
    });
    write.immediate();
    if (nextGeneration !== undefined) this.studyGeneration = nextGeneration;
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
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_avatars (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
        data BLOB NOT NULL CHECK (length(data) BETWEEN 1 AND 524288),
        version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_avatars_version_idx ON user_avatars(version);
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
      CREATE TABLE IF NOT EXISTS catalog_revisions (
        id TEXT PRIMARY KEY,
        catalog_id TEXT NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
        parent_revision_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('initial', 'update', 'merge', 'revert')),
        author_user_id TEXT,
        committer_user_id TEXT,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS catalog_revisions_catalog_created_idx ON catalog_revisions(catalog_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS catalog_revisions_parent_idx ON catalog_revisions(parent_revision_id);
      CREATE INDEX IF NOT EXISTS catalog_revisions_author_idx ON catalog_revisions(author_user_id);
      CREATE TABLE IF NOT EXISTS catalog_contributions (
        id TEXT PRIMARY KEY,
        catalog_id TEXT NOT NULL REFERENCES catalog(id) ON DELETE CASCADE,
        contributor_user_id TEXT,
        source_wordbook_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS catalog_contributions_catalog_status_idx ON catalog_contributions(catalog_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS catalog_contributions_contributor_status_idx ON catalog_contributions(contributor_user_id, status, created_at DESC);
    `);
    db.prepare("INSERT INTO metadata(key, value) VALUES (?, '0') ON CONFLICT(key) DO NOTHING").run(STUDY_STATE_GENERATION_KEY);
    const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === "role")) {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))");
    }
    const catalogColumns = db.prepare("PRAGMA table_info(catalog)").all() as Array<{ name: string }>;
    if (!catalogColumns.some((column) => column.name === "updated_at")) {
      db.exec("ALTER TABLE catalog ADD COLUMN updated_at TEXT");
    }
    if (!catalogColumns.some((column) => column.name === "head_revision_id")) {
      db.exec("ALTER TABLE catalog ADD COLUMN head_revision_id TEXT");
    }
    db.exec("CREATE INDEX IF NOT EXISTS catalog_visibility_updated_idx ON catalog(visibility, updated_at DESC)");
    createPrivateStateSchema(db);
  }

  private readStudyGeneration(db: Database.Database): number {
    const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(STUDY_STATE_GENERATION_KEY) as { value: string } | undefined;
    const parsed = Number(row?.value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private bumpStudyGeneration(db: Database.Database): number {
    db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = ?").run(STUDY_STATE_GENERATION_KEY);
    return this.readStudyGeneration(db);
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
      if (db.prepare("SELECT 1 FROM metadata WHERE key = ?").get(LEGACY_IMPORT_KEY)) return;
      if (legacy) {
        const empty = EMPTY();
        this.syncLegacyClients(db, empty, legacy);
        this.syncUsers(db, empty, legacy);
        this.syncUserAvatars(db, empty, legacy);
        this.syncCatalog(db, empty, legacy);
        this.syncRevisions(db, empty, legacy);
        this.syncContributions(db, empty, legacy);
        this.syncSessions(db, empty, legacy);
      }
      db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run(
        LEGACY_IMPORT_KEY,
        legacy ? "imported" : counts.count === 0 ? "no-source" : "skipped-nonempty",
      );
      db.prepare("INSERT INTO metadata(key, value) VALUES ('state_version', '6') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    });
    importOnce.immediate();
  }

  /** Stage legacy JSON rows for the one-time normalized private-state migration. */
  private syncLegacyClients(db: Database.Database, before: State, after: State): void {
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
      INSERT INTO users(id, username, password_hash, client_id, role, created_at)
      VALUES (@id, @username, @passwordHash, @clientId, @role, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        client_id = excluded.client_id,
        role = excluded.role,
        created_at = excluded.created_at
    `);
    const remove = db.prepare("DELETE FROM users WHERE id = ?");
    for (const user of after.users) if (!same(old.get(user.id), user)) upsert.run(user);
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }

  /** Used only by the one-time JSON import; ordinary SQLite avatar I/O stays lazy. */
  private syncUserAvatars(db: Database.Database, before: State, after: State): void {
    const upsert = db.prepare(`
      INSERT INTO user_avatars(user_id, mime_type, data, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        mime_type = excluded.mime_type,
        data = excluded.data,
        version = excluded.version,
        updated_at = excluded.updated_at
    `);
    const remove = db.prepare("DELETE FROM user_avatars WHERE user_id = ?");
    for (const [userId, avatar] of Object.entries(after.userAvatars)) {
      if (same(before.userAvatars[userId], avatar)) continue;
      const bytes = decodeAccountAvatar(avatar);
      if (bytes) upsert.run(userId, avatar.mimeType, bytes, avatar.version, avatar.updatedAt);
    }
    for (const userId of Object.keys(before.userAvatars)) {
      if (!(userId in after.userAvatars)) remove.run(userId);
    }
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
        created_at, updated_at, head_revision_id, uses, rating, share_code, data_json
      ) VALUES (
        @id, @ownerClientId, @authorUserId, @title, @author, @visibility,
        @createdAt, @updatedAt, @headRevisionId, @uses, @rating, @shareCode, @dataJson
      )
      ON CONFLICT(id) DO UPDATE SET
        owner_client_id = excluded.owner_client_id,
        author_user_id = excluded.author_user_id,
        title = excluded.title,
        author = excluded.author,
        visibility = excluded.visibility,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        head_revision_id = excluded.head_revision_id,
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
        updatedAt: book.updatedAt,
        headRevisionId: book.headRevisionId,
        uses: book.uses,
        rating: book.rating,
        shareCode: book.shareCode,
        dataJson: JSON.stringify(book),
      });
    }
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }

  private syncRevisions(db: Database.Database, before: State, after: State): void {
    const old = keyed(before.revisions, (revision) => revision.id);
    const current = keyed(after.revisions, (revision) => revision.id);
    const upsert = db.prepare(`
      INSERT INTO catalog_revisions(
        id, catalog_id, parent_revision_id, kind, author_user_id,
        committer_user_id, created_at, data_json
      ) VALUES (
        @id, @catalogId, @parentRevisionId, @kind, @authorUserId,
        @committerUserId, @createdAt, @dataJson
      )
      ON CONFLICT(id) DO UPDATE SET
        catalog_id = excluded.catalog_id,
        parent_revision_id = excluded.parent_revision_id,
        kind = excluded.kind,
        author_user_id = excluded.author_user_id,
        committer_user_id = excluded.committer_user_id,
        created_at = excluded.created_at,
        data_json = excluded.data_json
    `);
    const remove = db.prepare("DELETE FROM catalog_revisions WHERE id = ?");
    for (const revision of after.revisions) {
      if (same(old.get(revision.id), revision)) continue;
      upsert.run({
        id: revision.id,
        catalogId: revision.catalogId,
        parentRevisionId: revision.parentRevisionId ?? null,
        kind: revision.kind,
        authorUserId: revision.authorUserId ?? null,
        committerUserId: revision.committerUserId ?? null,
        createdAt: revision.createdAt,
        dataJson: JSON.stringify(revision),
      });
    }
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }

  private syncContributions(db: Database.Database, before: State, after: State): void {
    const old = keyed(before.contributions, (contribution) => contribution.id);
    const current = keyed(after.contributions, (contribution) => contribution.id);
    const upsert = db.prepare(`
      INSERT INTO catalog_contributions(
        id, catalog_id, contributor_user_id, source_wordbook_id,
        status, created_at, updated_at, data_json
      ) VALUES (
        @id, @catalogId, @contributorUserId, @sourceWordbookId,
        @status, @createdAt, @updatedAt, @dataJson
      )
      ON CONFLICT(id) DO UPDATE SET
        catalog_id = excluded.catalog_id,
        contributor_user_id = excluded.contributor_user_id,
        source_wordbook_id = excluded.source_wordbook_id,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `);
    const remove = db.prepare("DELETE FROM catalog_contributions WHERE id = ?");
    for (const contribution of after.contributions) {
      if (same(old.get(contribution.id), contribution)) continue;
      upsert.run({
        id: contribution.id,
        catalogId: contribution.catalogId,
        contributorUserId: contribution.contributorUserId ?? null,
        sourceWordbookId: contribution.sourceWordbookId,
        status: contribution.status,
        createdAt: contribution.createdAt,
        updatedAt: contribution.updatedAt,
        dataJson: JSON.stringify(contribution),
      });
    }
    for (const id of old.keys()) if (!current.has(id)) remove.run(id);
  }
}
