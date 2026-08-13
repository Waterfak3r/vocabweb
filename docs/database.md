# Database and Persistence

## Databases

The application uses two distinct SQLite concerns:

- Application state defaults to `backend/data/study-state.sqlite`, configured by `DATABASE_FILE` relative to the backend working directory.
- The generated dictionary defaults to `resources/dictionaries/generated/vocab.sqlite`, configured by `DICTIONARY_FILE` and opened read-only by the local dictionary provider.

Do not combine their schemas or treat the generated dictionary as mutable application state.

## Application Store Design

Production creates `SqliteStudyStore` and `SqliteEngagementStore` against the same application database file. Each owns its tables and exposes operations through a store interface rather than through route-level SQL.

`SqliteStudyStore` keeps immutable audit snapshots where they are useful, but private learner data is record-oriented:

- `users` and `sessions` are relational and constrained for identity and lifecycle queries.
- `user_avatars` stores bounded image BLOBs separately from hot session/user state. SQLite reads a BLOB for the owner's authenticated image route, the public current-version community route, or an account export. The random version metadata remains lightweight, unique, and supports safe cache invalidation.
- catalog wordbooks, revisions, and contributions have relational index columns plus JSON snapshots for domain payloads.
- `clients` identifies an anonymous/account data space and stores only small synchronized settings; favorites are rows in `client_favorites`.
- `dictionary_entries` stores immutable, content-addressed entry snapshots. `wordbook_words.id` remains the public/study `wordId`, scoped by client and wordbook, while its `entry_id` identifies dictionary content. The same spelling may therefore have multiple dictionary-entry identities without changing learning references.
- `wordbooks` stores small metadata records. `wordbook_words` stores order, the stable learner-facing id, the base entry revision, and an optional wordbook-local override. Editing one private copy cannot leak into another wordbook.
- `study_events` is the ordered learning history and `study_states` is its indexed current projection. Answering a card appends one event and upserts only the affected projection row.
- `study_rounds`, `study_round_word_ids`, `study_round_tasks`, `study_round_flags`, and `study_round_operations` keep resumable queues and operation idempotency as rows rather than one queue JSON document.
- import draft metadata and entries are split between `import_drafts` and `import_draft_entries`, so a large recoverable import does not enlarge a client document. Resolved draft entries reference the same content-addressed `dictionary_entries` rows as committed words (`import_draft_entries.entry_id`), so identical content is stored once across wordbooks and drafts.
- `metadata` records persistence version information and one-time import state.

`SqliteEngagementStore` owns relational tables for search events, feedback, site settings, messages, and unread notifications.

## Store Interfaces

- Express depends on `StudyStore` and `EngagementStore`, not concrete databases.
- `backend/src/server.ts` injects SQLite stores in production.
- `createApp` can use JSON/memory defaults or injected test stores, allowing route tests without production files.
- `BaseStore` retains study-domain transition semantics. Its frequent round/event mutations use client-scoped copy-on-write, sharing unchanged word arrays and global state. `SqliteStudyStore` transactionally upserts/deletes only changed rows.
- SQLite round creation selects stable word ids from `wordbook_words` and the indexed `study_states` projection. It does not reload or rewrite entry content to build a queue.
- The current domain compatibility view is materialized once per process and warmed by readiness. Later round starts reuse it; engagement writes do not invalidate it. A study write committed by another process advances the generation and deliberately rebuilds that view before the next operation.
- Cross-connection cache invalidation uses the `study_state_generation` metadata counter. Study/account/catalog writes advance it in the same transaction; engagement-table writes do not, so recording a search or message cannot force the next card request to reload every private word row.
- Every study-owned SQLite writer must use `SqliteStudyStore` (or advance `study_state_generation` in its transaction). Raw scripts that edit normalized study tables without advancing the counter are unsupported because a running process may retain its cached compatibility view.
- A write transaction compares the generation used to build its domain snapshot with the current generation. On a conflict the whole transition reloads and retries, preventing two server processes from assigning the same event sequence or overwriting each other's round operations.
- Add new behavior to the interface/domain layer first; keep SQL persistence as an implementation detail.

## Connection Rules

Store initialization enables:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `busy_timeout = 5000`

The deployment model is one application process writing a local SQLite volume. Do not run multiple containers against the same ordinary SQLite file volume without redesigning concurrency and operational guarantees.

## Schema Changes

There is no separate migration framework. Store startup owns compatible schema evolution:

- create new tables and indexes with idempotent `CREATE ... IF NOT EXISTS` statements;
- inspect existing columns before additive `ALTER TABLE` changes;
- preserve startup compatibility with databases created by earlier releases;
- update SQLite store tests for fresh creation and upgrade behavior;
- coordinate persisted JSON shape changes with the state migration logic in `backend/src/study/ladder.ts`.
- preserve the distinction between content identity (`dictionary_entries.id`) and the client-scoped learning identity (`wordbook_words.id`).

Never implement destructive or lossy migration implicitly. A schema or persisted-state change requires senior review, explicit rollback/backup consideration, and verification against an existing database fixture when possible.

## Legacy JSON Import

`DATA_FILE` defaults to `backend/data/study-state.json`. On first open, `SqliteStudyStore` imports it only when the application database is empty and the import marker is absent. The store then records whether data was imported, unavailable, or skipped.

Databases from the earlier hybrid store are upgraded by the separate `normalized_private_state_v1` marker. The upgrade reads each legacy `clients.data_json`, preserves client-scoped wordbook/word/event/round ids, writes the normalized rows, reduces the obsolete document to `{}`, and records the marker in one immediate transaction. A parse or constraint failure rolls back every normalized write and remains retryable. Concurrent first-open attempts recheck both import markers while holding the SQLite write lock. The production readiness check runs this upgrade before reporting ready.

`normalized_private_schema_v2` records the wordbook-scoped word identity. Startup also inspects the actual primary key, so a database created by the short-lived `(client_id, id)` development schema is transactionally rebuilt as `(client_id, wordbook_id, id)` even if its private-state marker already exists.

Changing the legacy JSON after that marker exists must not overwrite SQLite state. Preserve this one-time behavior when modifying initialization.

## Backup and Recovery

- Back up a running database through `npm run backup --prefix backend -- --output <path>` or the documented Compose wrapper; the CLI uses SQLite's online backup API and verifies integrity.
- Do not copy only the main database file while the service is writing, because WAL content may be omitted.
- Docker persists application state in the `vacab-data` volume. `docker compose down -v` deletes that volume and must not be used when data must survive.
- Recovery testing should use an isolated directory or volume, then run integrity and application verification before replacement.

For the first deployment containing `normalized_private_state_v1`, drain or stop every old application instance, retain a verified backup, confirm enough free space for the database plus WAL, then start one new instance and wait for `/api/health/ready` before scaling out. Rolling back to an older binary requires restoring that pre-upgrade backup because the old binary cannot reconstruct private data after `clients.data_json` has been reduced to `{}`.
