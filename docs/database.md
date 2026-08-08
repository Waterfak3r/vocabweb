# Database and Persistence

## Databases

The application uses two distinct SQLite concerns:

- Application state defaults to `backend/data/study-state.sqlite`, configured by `DATABASE_FILE` relative to the backend working directory.
- The generated dictionary defaults to `resources/dictionaries/generated/vocab.sqlite`, configured by `DICTIONARY_FILE` and opened read-only by the local dictionary provider.

Do not combine their schemas or treat the generated dictionary as mutable application state.

## Application Store Design

Production creates `SqliteStudyStore` and `SqliteEngagementStore` against the same application database file. Each owns its tables and exposes operations through a store interface rather than through route-level SQL.

`SqliteStudyStore` is intentionally hybrid:

- `users` and `sessions` are relational and constrained for identity and lifecycle queries.
- `user_avatars` stores bounded private image BLOBs separately from hot session/user state. SQLite reads a BLOB only for authenticated image delivery or an account export; the random version metadata remains lightweight and supports safe cache invalidation.
- catalog wordbooks, revisions, and contributions have relational index columns plus JSON snapshots for domain payloads.
- each anonymous or account data space has one `clients` row containing private learner state as JSON.
- `metadata` records persistence version information and one-time import state.

`SqliteEngagementStore` owns relational tables for search events, feedback, site settings, messages, and unread notifications.

## Store Interfaces

- Express depends on `StudyStore` and `EngagementStore`, not concrete databases.
- `backend/src/server.ts` injects SQLite stores in production.
- `createApp` can use JSON/memory defaults or injected test stores, allowing route tests without production files.
- `BaseStore` retains study-domain transition semantics. `SqliteStudyStore` loads state, applies a transition, diffs the result, and transactionally upserts/deletes only changed rows.
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

Never implement destructive or lossy migration implicitly. A schema or persisted-state change requires senior review, explicit rollback/backup consideration, and verification against an existing database fixture when possible.

## Legacy JSON Import

`DATA_FILE` defaults to `backend/data/study-state.json`. On first open, `SqliteStudyStore` imports it only when the application database is empty and the import marker is absent. The store then records whether data was imported, unavailable, or skipped.

Changing the legacy JSON after that marker exists must not overwrite SQLite state. Preserve this one-time behavior when modifying initialization.

## Backup and Recovery

- Back up a running database through `npm run backup --prefix backend -- --output <path>` or the documented Compose wrapper; the CLI uses SQLite's online backup API and verifies integrity.
- Do not copy only the main database file while the service is writing, because WAL content may be omitted.
- Docker persists application state in the `vacab-data` volume. `docker compose down -v` deletes that volume and must not be used when data must survive.
- Recovery testing should use an isolated directory or volume, then run integrity and application verification before replacement.
