import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { normalizeWord } from "../words/normalize.js";
import {
  defaultClient,
  migrate,
  replayLadder,
  reviewScheduleOf,
  type ClientData,
  type State,
  type WordLadderState,
} from "./ladder.js";
import type {
  ImportDraft,
  LearningEvent,
  MyWordbook,
  StudyRound,
  StudyRoundTask,
  StudyWordEntry,
  WordbookWord,
} from "./types.js";

export const PRIVATE_STATE_MIGRATION_KEY = "normalized_private_state_v1";
export const PRIVATE_SCHEMA_MIGRATION_KEY = "normalized_private_schema_v2";

type ClientRow = { client_id: string; data_json: string; study_settings_json: string | null };
type FavoriteRow = { client_id: string; catalog_id: string };
type WordbookRow = { id: string; client_id: string; data_json: string };
type WordRow = {
  client_id: string;
  id: string;
  wordbook_id: string;
  added_at: string;
  entry_json: string;
  override_json: string | null;
};
type OwnedJsonRow = { client_id: string; data_json: string };
type DraftRow = { id: string; client_id: string; data_json: string };
type DraftEntryRow = { client_id: string; draft_id: string; data_json: string };
type RoundRow = {
  id: string;
  client_id: string;
  wordbook_id: string;
  mode: StudyRound["mode"];
  scope: StudyRound["scope"];
  meaning_preference: StudyRound["meaningPreference"];
  exercise_types_json: string;
  revision: number;
  position: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  completed_at: string | null;
};
type RoundValueRow = { client_id: string; round_id: string; value: string };
type RoundTaskRow = { client_id: string; round_id: string; id: string; wordbook_word_id: string; exercise: StudyRoundTask["exercise"] };
type RoundFlagRow = { client_id: string; round_id: string; kind: RoundFlagKind; value: string };

const ROUND_FLAG_KINDS = ["passed-task", "completed-word", "mastered-word", "vague-word", "unknown-word"] as const;
type RoundFlagKind = (typeof ROUND_FLAG_KINDS)[number];

function same(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function keyed<T>(items: T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}

function ownedKey(clientId: string, id: string): string {
  return `${clientId}\u0000${id}`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function wordEntry(word: WordbookWord): StudyWordEntry {
  const { id: _id, addedAt: _addedAt, ...entry } = word;
  return entry;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalJson(item));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) result[key] = canonicalJson(item);
  }
  return result;
}

function canonicalEntry(entry: StudyWordEntry): StudyWordEntry {
  // Dictionary providers have historically attached attribution fields beyond the
  // study DTO (for example sources, availableLanguages, and meaning.sourceId).
  // Keep every JSON field while sorting keys so content-addressed ids stay stable.
  return canonicalJson(entry) as StudyWordEntry;
}

function entryHash(entry: StudyWordEntry): string {
  return createHash("sha256").update(JSON.stringify(canonicalEntry(entry))).digest("hex");
}

function wordbookMetadata(book: MyWordbook): Omit<MyWordbook, "words"> {
  const { words: _words, ...metadata } = book;
  return metadata;
}

function draftMetadata(draft: ImportDraft): Omit<ImportDraft, "entries"> {
  const { entries: _entries, ...metadata } = draft;
  return metadata;
}

function roundMetadata(round: StudyRound): Omit<
  StudyRound,
  | "wordIds"
  | "queue"
  | "passedTaskKeys"
  | "completedWordIds"
  | "masteredWordIds"
  | "vagueWordIds"
  | "unknownWordIds"
  | "processedOperationIds"
> {
  const {
    wordIds: _wordIds,
    queue: _queue,
    passedTaskKeys: _passedTaskKeys,
    completedWordIds: _completedWordIds,
    masteredWordIds: _masteredWordIds,
    vagueWordIds: _vagueWordIds,
    unknownWordIds: _unknownWordIds,
    processedOperationIds: _processedOperationIds,
    ...metadata
  } = round;
  return metadata;
}

function normalizeLegacyClient(value: unknown): ClientData {
  const client = value && typeof value === "object" ? value as Partial<ClientData> : {};
  return {
    favorites: Array.isArray(client.favorites) ? client.favorites : [],
    wordbooks: Array.isArray(client.wordbooks) ? client.wordbooks : [],
    events: Array.isArray(client.events) ? client.events : [],
    drafts: Array.isArray(client.drafts) ? client.drafts : [],
    ...(client.studySettings ? { studySettings: client.studySettings } : {}),
    studyRounds: Array.isArray(client.studyRounds) ? client.studyRounds : [],
  };
}

/** Create the record-oriented private-data schema. Existing databases are upgraded in place. */
export function createPrivateStateSchema(db: Database.Database): void {
  const clientColumns = db.prepare("PRAGMA table_info(clients)").all() as Array<{ name: string }>;
  if (!clientColumns.some((column) => column.name === "study_settings_json")) {
    db.exec("ALTER TABLE clients ADD COLUMN study_settings_json TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_favorites (
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      catalog_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (client_id, catalog_id)
    );
    CREATE INDEX IF NOT EXISTS client_favorites_catalog_idx
      ON client_favorites(catalog_id, client_id);

    CREATE TABLE IF NOT EXISTS dictionary_entries (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      normalized_word TEXT NOT NULL,
      display_word TEXT NOT NULL,
      phonetic TEXT NOT NULL,
      source TEXT NOT NULL,
      revision TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dictionary_entries_word_idx
      ON dictionary_entries(normalized_word, id);

    CREATE TABLE IF NOT EXISTS wordbooks (
      id TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_catalog_id TEXT,
      source_revision_id TEXT,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      data_json TEXT NOT NULL,
      PRIMARY KEY (client_id, id)
    );
    CREATE INDEX IF NOT EXISTS wordbooks_client_position_idx
      ON wordbooks(client_id, position);
    CREATE INDEX IF NOT EXISTS wordbooks_client_live_idx
      ON wordbooks(client_id, deleted_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS wordbooks_source_catalog_idx
      ON wordbooks(source_catalog_id, client_id);

    CREATE TABLE IF NOT EXISTS wordbook_words (
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
      PRIMARY KEY (client_id, wordbook_id, id),
      FOREIGN KEY (client_id, wordbook_id) REFERENCES wordbooks(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS wordbook_words_book_position_idx
      ON wordbook_words(client_id, wordbook_id, deleted_at, position);
    CREATE INDEX IF NOT EXISTS wordbook_words_book_word_idx
      ON wordbook_words(client_id, wordbook_id, normalized_word, deleted_at);
    CREATE INDEX IF NOT EXISTS wordbook_words_entry_idx
      ON wordbook_words(entry_id, client_id, wordbook_id);

    CREATE TABLE IF NOT EXISTS study_events (
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      wordbook_id TEXT NOT NULL,
      wordbook_word_id TEXT NOT NULL,
      word_snapshot TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('new', 'flashcard', 'dictation', 'mark')),
      occurred_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (client_id, id)
    );
    DROP INDEX IF EXISTS study_events_client_sequence_idx;
    CREATE INDEX IF NOT EXISTS study_events_client_order_idx
      ON study_events(client_id, sequence);
    CREATE INDEX IF NOT EXISTS study_events_book_time_idx
      ON study_events(client_id, wordbook_id, occurred_at, sequence);
    CREATE INDEX IF NOT EXISTS study_events_word_time_idx
      ON study_events(client_id, wordbook_id, wordbook_word_id, occurred_at, sequence);
    CREATE INDEX IF NOT EXISTS study_events_recent_idx
      ON study_events(client_id, occurred_at DESC, sequence DESC);

    CREATE TABLE IF NOT EXISTS study_states (
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      wordbook_id TEXT NOT NULL,
      wordbook_word_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
      level_reached_at TEXT,
      last_studied_at TEXT,
      recognition_streak INTEGER NOT NULL CHECK (recognition_streak BETWEEN 0 AND 2),
      review_interval_days INTEGER NOT NULL,
      next_review_at TEXT,
      ease_factor REAL NOT NULL,
      relearning INTEGER NOT NULL CHECK (relearning IN (0, 1)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (client_id, wordbook_id, wordbook_word_id)
    );
    CREATE INDEX IF NOT EXISTS study_states_due_idx
      ON study_states(client_id, wordbook_id, next_review_at, wordbook_word_id);
    CREATE INDEX IF NOT EXISTS study_states_level_due_idx
      ON study_states(client_id, wordbook_id, level, next_review_at, wordbook_word_id);

    CREATE TABLE IF NOT EXISTS import_drafts (
      id TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (client_id, id)
    );
    CREATE INDEX IF NOT EXISTS import_drafts_client_status_idx
      ON import_drafts(client_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS import_drafts_group_idx
      ON import_drafts(client_id, group_id, position);
    CREATE TABLE IF NOT EXISTS import_draft_entries (
      client_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      id TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (client_id, draft_id, id),
      FOREIGN KEY (client_id, draft_id) REFERENCES import_drafts(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS import_draft_entries_position_idx
      ON import_draft_entries(client_id, draft_id, position);

    CREATE TABLE IF NOT EXISTS study_rounds (
      id TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
      wordbook_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('new', 'review')),
      scope TEXT NOT NULL CHECK (scope IN ('standard', 'backlog', 'ahead')),
      meaning_preference TEXT NOT NULL CHECK (meaning_preference IN ('zh', 'en')),
      exercise_types_json TEXT NOT NULL,
      position INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (client_id, id)
    );
    CREATE INDEX IF NOT EXISTS study_rounds_active_idx
      ON study_rounds(client_id, wordbook_id, mode, scope, completed_at, expires_at);
    CREATE INDEX IF NOT EXISTS study_rounds_expires_idx
      ON study_rounds(expires_at);
    CREATE TABLE IF NOT EXISTS study_round_word_ids (
      client_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      wordbook_word_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (client_id, round_id, wordbook_word_id),
      FOREIGN KEY (client_id, round_id) REFERENCES study_rounds(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS study_round_word_ids_position_idx
      ON study_round_word_ids(client_id, round_id, position);
    CREATE TABLE IF NOT EXISTS study_round_tasks (
      client_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      id TEXT NOT NULL,
      wordbook_word_id TEXT NOT NULL,
      exercise TEXT NOT NULL CHECK (exercise IN ('self-rating', 'meaning-choice')),
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending')),
      PRIMARY KEY (client_id, round_id, id),
      FOREIGN KEY (client_id, round_id) REFERENCES study_rounds(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS study_round_tasks_next_idx
      ON study_round_tasks(client_id, round_id, status, position);
    CREATE TABLE IF NOT EXISTS study_round_flags (
      client_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('passed-task', 'completed-word', 'mastered-word', 'vague-word', 'unknown-word')),
      value TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (client_id, round_id, kind, value),
      FOREIGN KEY (client_id, round_id) REFERENCES study_rounds(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS study_round_flags_position_idx
      ON study_round_flags(client_id, round_id, kind, position);
    CREATE TABLE IF NOT EXISTS study_round_operations (
      client_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (client_id, round_id, operation_id),
      FOREIGN KEY (client_id, round_id) REFERENCES study_rounds(client_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS study_round_operations_position_idx
      ON study_round_operations(client_id, round_id, position);
  `);
  ensureWordbookWordScopedPrimaryKey(db);
}

function wordbookWordPrimaryKey(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info(wordbook_words)").all() as Array<{ name: string; pk: number }>)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

/** Upgrade databases produced by the short-lived client-only word-id schema. */
function ensureWordbookWordScopedPrimaryKey(db: Database.Database): void {
  const expected = ["client_id", "wordbook_id", "id"];
  const matches = () => same(wordbookWordPrimaryKey(db), expected);
  if (matches()) {
    db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(
      PRIVATE_SCHEMA_MIGRATION_KEY,
      JSON.stringify({ status: "complete", primaryKey: expected }),
    );
    return;
  }
  const upgrade = db.transaction(() => {
    if (!matches()) {
      db.exec(`
        DROP INDEX IF EXISTS wordbook_words_book_position_idx;
        DROP INDEX IF EXISTS wordbook_words_book_word_idx;
        DROP INDEX IF EXISTS wordbook_words_entry_idx;
        ALTER TABLE wordbook_words RENAME TO wordbook_words_legacy_client_key;
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
          PRIMARY KEY (client_id, wordbook_id, id),
          FOREIGN KEY (client_id, wordbook_id) REFERENCES wordbooks(client_id, id) ON DELETE CASCADE
        );
        INSERT INTO wordbook_words(
          id, client_id, wordbook_id, entry_id, normalized_word, position,
          added_at, base_revision, override_json, deleted_at
        )
        SELECT
          id, client_id, wordbook_id, entry_id, normalized_word, position,
          added_at, base_revision, override_json, deleted_at
        FROM wordbook_words_legacy_client_key;
        DROP TABLE wordbook_words_legacy_client_key;
        CREATE INDEX wordbook_words_book_position_idx
          ON wordbook_words(client_id, wordbook_id, deleted_at, position);
        CREATE INDEX wordbook_words_book_word_idx
          ON wordbook_words(client_id, wordbook_id, normalized_word, deleted_at);
        CREATE INDEX wordbook_words_entry_idx
          ON wordbook_words(entry_id, client_id, wordbook_id);
      `);
    }
    db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      PRIVATE_SCHEMA_MIGRATION_KEY,
      JSON.stringify({ status: "complete", primaryKey: expected }),
    );
  });
  upgrade.immediate();
}

/**
 * Convert every legacy per-client JSON document to record-oriented rows exactly once.
 * The marker and all row writes commit atomically; a failed conversion is restart-safe.
 */
export function migratePrivateStateIfNeeded(db: Database.Database): void {
  if (db.prepare("SELECT 1 FROM metadata WHERE key = ?").get(PRIVATE_STATE_MIGRATION_KEY)) return;
  const rows = db.prepare("SELECT client_id, data_json FROM clients ORDER BY client_id").all() as Array<{ client_id: string; data_json: string }>;
  const clients: Record<string, ClientData> = {};
  for (const row of rows) clients[row.client_id] = normalizeLegacyClient(parseJson<unknown>(row.data_json));
  const before: State = {
    version: 6,
    catalog: [],
    revisions: [],
    contributions: [],
    clients: {},
    users: [],
    userAvatars: {},
    sessions: [],
  };
  const after = migrate({ ...before, clients });
  const migrateRows = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM metadata WHERE key = ?").get(PRIVATE_STATE_MIGRATION_KEY)) return;
    // No released version wrote these tables before this marker existed. Clearing them makes a
    // manually interrupted development migration deterministic without touching legacy JSON.
    db.exec(`
      DELETE FROM study_round_operations;
      DELETE FROM study_round_flags;
      DELETE FROM study_round_tasks;
      DELETE FROM study_round_word_ids;
      DELETE FROM study_rounds;
      DELETE FROM import_draft_entries;
      DELETE FROM import_drafts;
      DELETE FROM study_states;
      DELETE FROM study_events;
      DELETE FROM wordbook_words;
      DELETE FROM wordbooks;
      DELETE FROM client_favorites;
      DELETE FROM dictionary_entries;
    `);
    syncPrivateClients(db, before, after);
    db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)").run(
      PRIVATE_STATE_MIGRATION_KEY,
      JSON.stringify({ status: "complete", clients: rows.length }),
    );
  });
  migrateRows.immediate();
}

/** Reconstruct BaseStore's compatibility view from normalized private rows. */
export function loadPrivateClients(db: Database.Database): Record<string, ClientData> {
  const clients: Record<string, ClientData> = {};
  for (const row of db.prepare("SELECT client_id, data_json, study_settings_json FROM clients ORDER BY client_id").all() as ClientRow[]) {
    const client = defaultClient();
    if (row.study_settings_json) client.studySettings = parseJson(row.study_settings_json);
    clients[row.client_id] = client;
  }
  for (const row of db.prepare("SELECT client_id, catalog_id FROM client_favorites ORDER BY client_id, position").all() as FavoriteRow[]) {
    (clients[row.client_id] ??= defaultClient()).favorites.push(row.catalog_id);
  }

  const books = new Map<string, MyWordbook>();
  for (const row of db.prepare("SELECT id, client_id, data_json FROM wordbooks ORDER BY client_id, position").all() as WordbookRow[]) {
    const book = { ...parseJson<Omit<MyWordbook, "words">>(row.data_json), words: [] } as MyWordbook;
    (clients[row.client_id] ??= defaultClient()).wordbooks.push(book);
    books.set(ownedKey(row.client_id, row.id), book);
  }
  for (const row of db.prepare(`
    SELECT w.client_id, w.id, w.wordbook_id, w.added_at, e.data_json AS entry_json, w.override_json
    FROM wordbook_words w
    JOIN dictionary_entries e ON e.id = w.entry_id
    WHERE w.deleted_at IS NULL
    ORDER BY w.client_id, w.wordbook_id, w.position
  `).all() as WordRow[]) {
    const entry = row.override_json ? parseJson<StudyWordEntry>(row.override_json) : parseJson<StudyWordEntry>(row.entry_json);
    books.get(ownedKey(row.client_id, row.wordbook_id))?.words.push({ ...entry, id: row.id, addedAt: row.added_at });
  }

  for (const row of db.prepare("SELECT client_id, data_json FROM study_events ORDER BY client_id, sequence").all() as OwnedJsonRow[]) {
    (clients[row.client_id] ??= defaultClient()).events.push(parseJson<LearningEvent>(row.data_json));
  }

  const drafts = new Map<string, ImportDraft>();
  for (const row of db.prepare("SELECT id, client_id, data_json FROM import_drafts ORDER BY client_id, position").all() as DraftRow[]) {
    const draft = { ...parseJson<Omit<ImportDraft, "entries">>(row.data_json), entries: [] } as ImportDraft;
    (clients[row.client_id] ??= defaultClient()).drafts.push(draft);
    drafts.set(ownedKey(row.client_id, row.id), draft);
  }
  for (const row of db.prepare("SELECT client_id, draft_id, data_json FROM import_draft_entries ORDER BY client_id, draft_id, position").all() as DraftEntryRow[]) {
    drafts.get(ownedKey(row.client_id, row.draft_id))?.entries.push(parseJson(row.data_json));
  }

  const rounds = new Map<string, StudyRound>();
  for (const row of db.prepare("SELECT * FROM study_rounds ORDER BY client_id, position").all() as RoundRow[]) {
    const round: StudyRound = {
      id: row.id,
      wordbookId: row.wordbook_id,
      mode: row.mode,
      scope: row.scope,
      meaningPreference: row.meaning_preference,
      exerciseTypes: parseJson(row.exercise_types_json),
      wordIds: [],
      queue: [],
      passedTaskKeys: [],
      completedWordIds: [],
      masteredWordIds: [],
      vagueWordIds: [],
      unknownWordIds: [],
      processedOperationIds: [],
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    };
    (clients[row.client_id] ??= defaultClient()).studyRounds.push(round);
    rounds.set(ownedKey(row.client_id, row.id), round);
  }
  for (const row of db.prepare("SELECT client_id, round_id, wordbook_word_id AS value FROM study_round_word_ids ORDER BY client_id, round_id, position").all() as RoundValueRow[]) {
    rounds.get(ownedKey(row.client_id, row.round_id))?.wordIds.push(row.value);
  }
  for (const row of db.prepare("SELECT client_id, round_id, id, wordbook_word_id, exercise FROM study_round_tasks ORDER BY client_id, round_id, position").all() as RoundTaskRow[]) {
    rounds.get(ownedKey(row.client_id, row.round_id))?.queue.push({ id: row.id, wordId: row.wordbook_word_id, exercise: row.exercise });
  }
  for (const row of db.prepare("SELECT client_id, round_id, kind, value FROM study_round_flags ORDER BY client_id, round_id, kind, position").all() as RoundFlagRow[]) {
    const round = rounds.get(ownedKey(row.client_id, row.round_id));
    if (!round) continue;
    if (row.kind === "passed-task") round.passedTaskKeys.push(row.value);
    else if (row.kind === "completed-word") round.completedWordIds.push(row.value);
    else if (row.kind === "mastered-word") round.masteredWordIds.push(row.value);
    else if (row.kind === "vague-word") round.vagueWordIds.push(row.value);
    else round.unknownWordIds.push(row.value);
  }
  for (const row of db.prepare("SELECT client_id, round_id, operation_id AS value FROM study_round_operations ORDER BY client_id, round_id, position").all() as RoundValueRow[]) {
    rounds.get(ownedKey(row.client_id, row.round_id))?.processedOperationIds.push(row.value);
  }
  return clients;
}

/** Persist private data as small independently addressable rows. */
export function syncPrivateClients(db: Database.Database, before: State, after: State): void {
  const upsertClient = db.prepare(`
    INSERT INTO clients(client_id, data_json, study_settings_json)
    VALUES (?, '{}', ?)
    ON CONFLICT(client_id) DO UPDATE SET
      data_json = '{}',
      study_settings_json = excluded.study_settings_json
  `);
  const removeClient = db.prepare("DELETE FROM clients WHERE client_id = ?");

  for (const [clientId, client] of Object.entries(after.clients)) {
    const oldClient = before.clients[clientId];
    if (!oldClient || !same(oldClient.studySettings, client.studySettings)) {
      upsertClient.run(clientId, client.studySettings ? JSON.stringify(client.studySettings) : null);
    } else {
      // Existing legacy rows may still contain their obsolete large document during migration.
      db.prepare("UPDATE clients SET data_json = '{}' WHERE client_id = ? AND data_json <> '{}'").run(clientId);
    }
    if (!oldClient || !same(oldClient.favorites, client.favorites)) syncFavorites(db, clientId, client.favorites);
    if (!oldClient || oldClient.wordbooks !== client.wordbooks) syncWordbooks(db, clientId, oldClient?.wordbooks ?? [], client.wordbooks);

    const affectedStates = new Map<string, { wordbookId: string; wordId: string }>();
    if (!oldClient || oldClient.events !== client.events) {
      for (const item of syncEvents(db, clientId, oldClient?.events ?? [], client.events)) affectedStates.set(item.key, item.value);
    }
    collectScheduleChanges(oldClient?.wordbooks ?? [], client.wordbooks, client.events, affectedStates);
    syncStudyStates(db, clientId, client, affectedStates.values());

    if (!oldClient || oldClient.drafts !== client.drafts) syncDrafts(db, clientId, oldClient?.drafts ?? [], client.drafts);
    if (!oldClient || oldClient.studyRounds !== client.studyRounds) syncRounds(db, clientId, oldClient?.studyRounds ?? [], client.studyRounds);
  }
  for (const clientId of Object.keys(before.clients)) {
    if (!(clientId in after.clients)) removeClient.run(clientId);
  }
}

function syncFavorites(db: Database.Database, clientId: string, favorites: string[]): void {
  db.prepare("DELETE FROM client_favorites WHERE client_id = ?").run(clientId);
  const insert = db.prepare("INSERT INTO client_favorites(client_id, catalog_id, position) VALUES (?, ?, ?)");
  favorites.forEach((catalogId, position) => insert.run(clientId, catalogId, position));
}

function ensureDictionaryEntry(db: Database.Database, entry: StudyWordEntry, createdAt: string): string {
  const canonical = canonicalEntry(entry);
  const hash = entryHash(canonical);
  const id = `entry-${hash}`;
  db.prepare(`
    INSERT INTO dictionary_entries(
      id, content_hash, normalized_word, display_word, phonetic, source, revision, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO NOTHING
  `).run(id, hash, normalizeWord(canonical.word), canonical.word, canonical.phonetic, canonical.source, hash, JSON.stringify(canonical), createdAt);
  const row = db.prepare("SELECT id FROM dictionary_entries WHERE content_hash = ?").get(hash) as { id: string } | undefined;
  if (!row) throw new Error("Failed to persist dictionary entry");
  return row.id;
}

function syncWordbooks(db: Database.Database, clientId: string, before: MyWordbook[], after: MyWordbook[]): void {
  const old = keyed(before, (book) => book.id);
  const current = keyed(after, (book) => book.id);
  const oldPositions = new Map(before.map((book, position) => [book.id, position]));
  const upsert = db.prepare(`
    INSERT INTO wordbooks(
      id, client_id, position, title, source_catalog_id, source_revision_id, updated_at, deleted_at, data_json
    ) VALUES (@id, @clientId, @position, @title, @sourceCatalogId, @sourceRevisionId, @updatedAt, @deletedAt, @dataJson)
    ON CONFLICT(client_id, id) DO UPDATE SET
      position = excluded.position,
      title = excluded.title,
      source_catalog_id = excluded.source_catalog_id,
      source_revision_id = excluded.source_revision_id,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      data_json = excluded.data_json
  `);
  for (const [position, book] of after.entries()) {
    const previous = old.get(book.id);
    const metadata = wordbookMetadata(book);
    if (!previous || oldPositions.get(book.id) !== position || !same(wordbookMetadata(previous), metadata)) {
      upsert.run({
        id: book.id,
        clientId,
        position,
        title: book.title,
        sourceCatalogId: book.sourceCatalogId ?? null,
        sourceRevisionId: book.sourceRevisionId ?? null,
        updatedAt: book.updatedAt,
        deletedAt: book.deletedAt ?? null,
        dataJson: JSON.stringify(metadata),
      });
    }
    if (!previous || previous.words !== book.words) syncWordbookWords(db, clientId, book, previous?.words ?? [], book.words);
  }
  const remove = db.prepare("DELETE FROM wordbooks WHERE client_id = ? AND id = ?");
  for (const id of old.keys()) if (!current.has(id)) remove.run(clientId, id);
}

function syncWordbookWords(db: Database.Database, clientId: string, book: MyWordbook, before: WordbookWord[], after: WordbookWord[]): void {
  const old = keyed(before, (word) => word.id);
  const current = keyed(after, (word) => word.id);
  const oldPositions = new Map(before.map((word, position) => [word.id, position]));
  const existingLink = db.prepare(`
    SELECT w.entry_id, e.revision AS base_revision, e.data_json AS entry_json
    FROM wordbook_words w
    JOIN dictionary_entries e ON e.id = w.entry_id
    WHERE w.client_id = ? AND w.wordbook_id = ? AND w.id = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO wordbook_words(client_id, id, wordbook_id, entry_id, normalized_word, position, added_at, base_revision, override_json, deleted_at)
    VALUES (@clientId, @id, @wordbookId, @entryId, @normalizedWord, @position, @addedAt, @baseRevision, @overrideJson, NULL)
    ON CONFLICT(client_id, wordbook_id, id) DO UPDATE SET
      entry_id = excluded.entry_id,
      normalized_word = excluded.normalized_word,
      position = excluded.position,
      added_at = excluded.added_at,
      base_revision = excluded.base_revision,
      override_json = excluded.override_json,
      deleted_at = NULL
  `);
  for (const [position, word] of after.entries()) {
    const previous = old.get(word.id);
    if (previous === word && oldPositions.get(word.id) === position) continue;
    if (previous && oldPositions.get(word.id) === position && same(previous, word)) continue;
    const effective = canonicalEntry(wordEntry(word));
    const normalized = normalizeWord(effective.word);
    const stored = existingLink.get(clientId, book.id, word.id) as { entry_id: string; base_revision: string; entry_json: string } | undefined;
    let entryId: string;
    let baseRevision: string;
    let overrideJson: string | null = null;
    if (previous && stored && normalizeWord(previous.word) === normalized) {
      entryId = stored.entry_id;
      baseRevision = stored.base_revision;
      const base = parseJson<StudyWordEntry>(stored.entry_json);
      if (!same(base, effective)) overrideJson = JSON.stringify(effective);
    } else {
      entryId = ensureDictionaryEntry(db, effective, word.addedAt);
      baseRevision = entryId.slice("entry-".length);
    }
    upsert.run({
      clientId,
      id: word.id,
      wordbookId: book.id,
      entryId,
      normalizedWord: normalized,
      position,
      addedAt: word.addedAt,
      baseRevision,
      overrideJson,
    });
  }
  const softDelete = db.prepare("UPDATE wordbook_words SET deleted_at = ? WHERE client_id = ? AND wordbook_id = ? AND id = ? AND deleted_at IS NULL");
  for (const id of old.keys()) if (!current.has(id)) softDelete.run(book.updatedAt, clientId, book.id, id);
}

function eventKey(event: Pick<LearningEvent, "wordbookId" | "wordId">): string {
  return `${event.wordbookId}\u0000${event.wordId}`;
}

function syncEvents(
  db: Database.Database,
  clientId: string,
  before: LearningEvent[],
  after: LearningEvent[],
): Array<{ key: string; value: { wordbookId: string; wordId: string } }> {
  const old = keyed(before, (event) => event.id);
  const current = keyed(after, (event) => event.id);
  const oldPositions = new Map(before.map((event, position) => [event.id, position]));
  const affected = new Map<string, { wordbookId: string; wordId: string }>();
  const touch = (event: LearningEvent) => affected.set(eventKey(event), { wordbookId: event.wordbookId, wordId: event.wordId });
  const upsert = db.prepare(`
    INSERT INTO study_events(
      client_id, id, sequence, wordbook_id, wordbook_word_id, word_snapshot, kind, occurred_at, data_json
    ) VALUES (@clientId, @id, @sequence, @wordbookId, @wordId, @word, @kind, @occurredAt, @dataJson)
    ON CONFLICT(client_id, id) DO UPDATE SET
      sequence = excluded.sequence,
      wordbook_id = excluded.wordbook_id,
      wordbook_word_id = excluded.wordbook_word_id,
      word_snapshot = excluded.word_snapshot,
      kind = excluded.kind,
      occurred_at = excluded.occurred_at,
      data_json = excluded.data_json
  `);
  for (const [sequence, event] of after.entries()) {
    const previous = old.get(event.id);
    if (previous === event && oldPositions.get(event.id) === sequence) continue;
    if (previous && oldPositions.get(event.id) === sequence && same(previous, event)) continue;
    if (previous) touch(previous);
    touch(event);
    upsert.run({
      clientId,
      id: event.id,
      sequence,
      wordbookId: event.wordbookId,
      wordId: event.wordId,
      word: event.word,
      kind: event.kind,
      occurredAt: event.occurredAt,
      dataJson: JSON.stringify(event),
    });
  }
  const remove = db.prepare("DELETE FROM study_events WHERE client_id = ? AND id = ?");
  for (const [id, event] of old) {
    if (current.has(id)) continue;
    touch(event);
    remove.run(clientId, id);
  }
  return [...affected].map(([key, value]) => ({ key, value }));
}

function collectScheduleChanges(
  before: MyWordbook[],
  after: MyWordbook[],
  events: LearningEvent[],
  affected: Map<string, { wordbookId: string; wordId: string }>,
): void {
  const old = keyed(before, (book) => book.id);
  const changedBooks = new Set<string>();
  for (const book of after) {
    const previous = old.get(book.id);
    if (previous && !same(previous.reviewSchedule, book.reviewSchedule)) changedBooks.add(book.id);
  }
  for (const event of events) {
    if (changedBooks.has(event.wordbookId)) affected.set(eventKey(event), { wordbookId: event.wordbookId, wordId: event.wordId });
  }
}

function syncStudyStates(
  db: Database.Database,
  clientId: string,
  client: ClientData,
  affected: Iterable<{ wordbookId: string; wordId: string }>,
): void {
  const upsert = db.prepare(`
    INSERT INTO study_states(
      client_id, wordbook_id, wordbook_word_id, level, level_reached_at, last_studied_at,
      recognition_streak, review_interval_days, next_review_at, ease_factor, relearning, updated_at
    ) VALUES (
      @clientId, @wordbookId, @wordId, @level, @levelReachedAt, @lastStudiedAt,
      @recognitionStreak, @reviewIntervalDays, @nextReviewAt, @easeFactor, @relearning, @updatedAt
    )
    ON CONFLICT(client_id, wordbook_id, wordbook_word_id) DO UPDATE SET
      level = excluded.level,
      level_reached_at = excluded.level_reached_at,
      last_studied_at = excluded.last_studied_at,
      recognition_streak = excluded.recognition_streak,
      review_interval_days = excluded.review_interval_days,
      next_review_at = excluded.next_review_at,
      ease_factor = excluded.ease_factor,
      relearning = excluded.relearning,
      updated_at = excluded.updated_at
  `);
  const remove = db.prepare("DELETE FROM study_states WHERE client_id = ? AND wordbook_id = ? AND wordbook_word_id = ?");
  for (const item of affected) {
    const events = client.events
      .filter((event) => event.wordbookId === item.wordbookId && event.wordId === item.wordId)
      // Match ladderStates(): clocks can be rewound and equal timestamps retain insertion order.
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
    if (!events.length) {
      remove.run(clientId, item.wordbookId, item.wordId);
      continue;
    }
    const book = client.wordbooks.find((candidate) => candidate.id === item.wordbookId);
    const state = replayLadder(events, undefined, reviewScheduleOf(book ?? {}));
    const updatedAt = state.lastStudiedAt ?? events.at(-1)?.occurredAt ?? new Date(0).toISOString();
    upsert.run(studyStateParameters(clientId, item.wordbookId, item.wordId, state, updatedAt));
  }
}

function studyStateParameters(
  clientId: string,
  wordbookId: string,
  wordId: string,
  state: WordLadderState,
  updatedAt: string,
): Record<string, unknown> {
  return {
    clientId,
    wordbookId,
    wordId,
    level: state.level,
    levelReachedAt: state.levelReachedAt ?? null,
    lastStudiedAt: state.lastStudiedAt ?? null,
    recognitionStreak: state.recognitionStreak,
    reviewIntervalDays: state.reviewIntervalDays,
    nextReviewAt: state.nextReviewAt ?? null,
    easeFactor: state.easeFactor,
    relearning: state.relearning ? 1 : 0,
    updatedAt,
  };
}

function syncDrafts(db: Database.Database, clientId: string, before: ImportDraft[], after: ImportDraft[]): void {
  const old = keyed(before, (draft) => draft.id);
  const current = keyed(after, (draft) => draft.id);
  const oldPositions = new Map(before.map((draft, position) => [draft.id, position]));
  const upsert = db.prepare(`
    INSERT INTO import_drafts(id, client_id, position, group_id, status, updated_at, data_json)
    VALUES (@id, @clientId, @position, @groupId, @status, @updatedAt, @dataJson)
    ON CONFLICT(client_id, id) DO UPDATE SET
      position = excluded.position,
      group_id = excluded.group_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `);
  for (const [position, draft] of after.entries()) {
    const previous = old.get(draft.id);
    const metadata = draftMetadata(draft);
    if (!previous || oldPositions.get(draft.id) !== position || !same(draftMetadata(previous), metadata)) {
      upsert.run({
        id: draft.id,
        clientId,
        position,
        groupId: draft.groupId,
        status: draft.status,
        updatedAt: draft.updatedAt,
        dataJson: JSON.stringify(metadata),
      });
    }
    if (!previous || previous.entries !== draft.entries) syncDraftEntries(db, clientId, draft.id, previous?.entries ?? [], draft.entries);
  }
  const remove = db.prepare("DELETE FROM import_drafts WHERE client_id = ? AND id = ?");
  for (const id of old.keys()) if (!current.has(id)) remove.run(clientId, id);
}

function syncDraftEntries(
  db: Database.Database,
  clientId: string,
  draftId: string,
  before: ImportDraft["entries"],
  after: ImportDraft["entries"],
): void {
  const old = keyed(before, (entry) => entry.id);
  const current = keyed(after, (entry) => entry.id);
  const oldPositions = new Map(before.map((entry, position) => [entry.id, position]));
  const upsert = db.prepare(`
    INSERT INTO import_draft_entries(client_id, draft_id, id, position, status, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id, draft_id, id) DO UPDATE SET
      position = excluded.position,
      status = excluded.status,
      data_json = excluded.data_json
  `);
  for (const [position, entry] of after.entries()) {
    const previous = old.get(entry.id);
    if (previous === entry && oldPositions.get(entry.id) === position) continue;
    if (previous && oldPositions.get(entry.id) === position && same(previous, entry)) continue;
    upsert.run(clientId, draftId, entry.id, position, entry.status, JSON.stringify(entry));
  }
  const remove = db.prepare("DELETE FROM import_draft_entries WHERE client_id = ? AND draft_id = ? AND id = ?");
  for (const id of old.keys()) if (!current.has(id)) remove.run(clientId, draftId, id);
}

function syncRounds(db: Database.Database, clientId: string, before: StudyRound[], after: StudyRound[]): void {
  const old = keyed(before, (round) => round.id);
  const current = keyed(after, (round) => round.id);
  const oldPositions = new Map(before.map((round, position) => [round.id, position]));
  const upsert = db.prepare(`
    INSERT INTO study_rounds(
      id, client_id, wordbook_id, mode, scope, meaning_preference, exercise_types_json, position,
      revision, created_at, updated_at, expires_at, completed_at
    ) VALUES (
      @id, @clientId, @wordbookId, @mode, @scope, @meaningPreference, @exerciseTypesJson, @position,
      @revision, @createdAt, @updatedAt, @expiresAt, @completedAt
    )
    ON CONFLICT(client_id, id) DO UPDATE SET
      wordbook_id = excluded.wordbook_id,
      mode = excluded.mode,
      scope = excluded.scope,
      meaning_preference = excluded.meaning_preference,
      exercise_types_json = excluded.exercise_types_json,
      position = excluded.position,
      revision = excluded.revision,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at,
      completed_at = excluded.completed_at
  `);
  for (const [position, round] of after.entries()) {
    const previous = old.get(round.id);
    if (!previous || oldPositions.get(round.id) !== position || !same(roundMetadata(previous), roundMetadata(round))) {
      upsert.run({
        id: round.id,
        clientId,
        wordbookId: round.wordbookId,
        mode: round.mode,
        scope: round.scope,
        meaningPreference: round.meaningPreference,
        exerciseTypesJson: JSON.stringify(round.exerciseTypes),
        position,
        revision: round.revision,
        createdAt: round.createdAt,
        updatedAt: round.updatedAt,
        expiresAt: round.expiresAt,
        completedAt: round.completedAt ?? null,
      });
    }
    if (!previous || previous.wordIds !== round.wordIds) syncRoundValues(db, "study_round_word_ids", "wordbook_word_id", clientId, round.id, previous?.wordIds ?? [], round.wordIds);
    if (!previous || previous.queue !== round.queue) syncRoundTasks(db, clientId, round.id, previous?.queue ?? [], round.queue);
    syncRoundFlag(db, clientId, round.id, "passed-task", previous?.passedTaskKeys ?? [], round.passedTaskKeys);
    syncRoundFlag(db, clientId, round.id, "completed-word", previous?.completedWordIds ?? [], round.completedWordIds);
    syncRoundFlag(db, clientId, round.id, "mastered-word", previous?.masteredWordIds ?? [], round.masteredWordIds);
    syncRoundFlag(db, clientId, round.id, "vague-word", previous?.vagueWordIds ?? [], round.vagueWordIds);
    syncRoundFlag(db, clientId, round.id, "unknown-word", previous?.unknownWordIds ?? [], round.unknownWordIds);
    if (!previous || previous.processedOperationIds !== round.processedOperationIds) {
      syncRoundValues(db, "study_round_operations", "operation_id", clientId, round.id, previous?.processedOperationIds ?? [], round.processedOperationIds);
    }
  }
  const remove = db.prepare("DELETE FROM study_rounds WHERE client_id = ? AND id = ?");
  for (const id of old.keys()) if (!current.has(id)) remove.run(clientId, id);
}

function syncRoundValues(
  db: Database.Database,
  table: "study_round_word_ids" | "study_round_operations",
  column: "wordbook_word_id" | "operation_id",
  clientId: string,
  roundId: string,
  before: string[],
  after: string[],
): void {
  if (same(before, after)) return;
  db.prepare(`DELETE FROM ${table} WHERE client_id = ? AND round_id = ?`).run(clientId, roundId);
  const insert = db.prepare(`INSERT INTO ${table}(client_id, round_id, ${column}, position) VALUES (?, ?, ?, ?)`);
  after.forEach((value, position) => insert.run(clientId, roundId, value, position));
}

function syncRoundTasks(db: Database.Database, clientId: string, roundId: string, before: StudyRoundTask[], after: StudyRoundTask[]): void {
  const old = keyed(before, (task) => task.id);
  const current = keyed(after, (task) => task.id);
  const oldPositions = new Map(before.map((task, position) => [task.id, position]));
  const upsert = db.prepare(`
    INSERT INTO study_round_tasks(client_id, round_id, id, wordbook_word_id, exercise, position, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(client_id, round_id, id) DO UPDATE SET
      wordbook_word_id = excluded.wordbook_word_id,
      exercise = excluded.exercise,
      position = excluded.position,
      status = 'pending'
  `);
  for (const [position, task] of after.entries()) {
    const previous = old.get(task.id);
    if (previous === task && oldPositions.get(task.id) === position) continue;
    if (previous && oldPositions.get(task.id) === position && same(previous, task)) continue;
    upsert.run(clientId, roundId, task.id, task.wordId, task.exercise, position);
  }
  const remove = db.prepare("DELETE FROM study_round_tasks WHERE client_id = ? AND round_id = ? AND id = ?");
  for (const id of old.keys()) if (!current.has(id)) remove.run(clientId, roundId, id);
}

function syncRoundFlag(
  db: Database.Database,
  clientId: string,
  roundId: string,
  kind: RoundFlagKind,
  before: string[],
  after: string[],
): void {
  if (same(before, after)) return;
  db.prepare("DELETE FROM study_round_flags WHERE client_id = ? AND round_id = ? AND kind = ?").run(clientId, roundId, kind);
  const insert = db.prepare("INSERT INTO study_round_flags(client_id, round_id, kind, value, position) VALUES (?, ?, ?, ?, ?)");
  after.forEach((value, position) => insert.run(clientId, roundId, kind, value, position));
}
