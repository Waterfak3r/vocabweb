# Architecture

This document describes stable component boundaries. For commands and deployment, see `development.md`; for persistence and HTTP contracts, see `database.md` and `api.md`.

## System Shape

```text
React/Vite browser
  -> same-origin /api clients
  -> Express middleware and routes
  -> domain services and store interfaces
  -> application SQLite / local dictionary SQLite / remote dictionary fallback
```

During development Vite proxies `/api` to Express. Production builds the SPA into `frontend/dist`, which Express serves alongside the API. Docker places Caddy in front of that single application origin.

## Frontend

- `frontend/src/main.tsx` installs global styles, `BrowserRouter`, and the application root.
- `frontend/src/App.tsx` defines lazy-loaded routes inside the shared application shell.
- `pages/` composes routed screens; `components/` contains reusable presentation and interaction; `features/` owns flashcard and dictation sessions.
- `hooks/` coordinates UI lifecycle and state. Keep reusable domain rules in `domain/` and browser/infrastructure concerns in `data/` or `lib/`.
- `data/` is the network and persistence boundary. API modules build URLs from `VITE_API_BASE`, include session credentials when required, and runtime-validate unknown JSON before returning typed values.
- `components/ui/` and `styles/tokens.css` are the shared visual primitives. Global style files are layered from `main.tsx`; some complex components use colocated CSS modules.

### Frontend State

- Component-local React state handles transient view state.
- Feature hooks own disposable study-session state; it is not a durable source of truth.
- `AuthProvider` performs one shared session lookup and exposes account actions.
- Account avatars are center-cropped and re-encoded in the browser before the typed account adapter uploads them; the shared auth context replaces its lightweight user DTO so the profile and header update together.
- Zustand `wordbookStore.ts` persists the legacy/local wordbook to `localStorage`.
- Synced personal wordbooks, study progress, marketplace data, collaboration, and account operations flow through `WorkspaceApi` and the backend.
- Browser storage also holds anonymous client identity, preferences, and bounded caches. The session cookie—not stored client identity—is the authentication credential.

## Backend

- `backend/src/server.ts` is the production composition root. It loads validated configuration, creates providers/rate limiters/stores, starts the app, performs readiness checks, and closes resources on shutdown.
- `backend/src/app.ts` owns Express middleware and `/api` routes. Dependencies enter through `createApp` options so tests can inject controlled implementations.
- `backend/src/study/validation.ts` parses untrusted study, wordbook, marketplace, and collaboration inputs before domain operations run.
- `backend/src/study/types.ts` defines the backend domain/store contract; `store.ts` contains domain behavior and compatibility stores; `sqlite-store.ts` supplies production persistence.
- `backend/src/auth.ts` owns password hashing, session tokens, and cookie utilities; `authorization.ts` maps roles to capabilities.
- Account avatar validation is isolated in `backend/src/account-avatar.ts`; production stores its bounded BLOB separately and reads it only for versioned authenticated image delivery or an account export.
- `backend/src/engagement/store.ts` isolates search analytics, feedback, site settings, messages, and message notifications behind an engagement-store interface.
- `backend/src/words/` contains normalization, provider-facing types, caching, and lookup service logic. `providers/` contains the local SQLite dictionary, the remote WiktAPI definition fallback, and the Youdao pronunciation adapter.

## Primary Data Flows

### Dictionary Lookup

1. UI code calls a repository in `frontend/src/data/`.
2. Express validates and normalizes the query, then applies lookup rate limits.
3. The word service checks its bounded in-process cache.
4. The production provider queries the generated local dictionary first and optionally falls back to WiktApi.
5. The frontend validates the response DTO before exposing it to components.

### Pronunciation Playback

1. The UI starts a same-origin `/api/pronunciations/:word/audio?accent=gb|us` media request inside the playback gesture.
2. Express selects the requested accent and redirects to the corresponding Youdao pronunciation URL; British uses `type=1` and American uses `type=2`.
3. If online media cannot play, the frontend falls back to Web Speech with `en-GB` or `en-US`. It binds a system voice only when that exact locale exists, so an opposite-accent voice is not mislabeled as the requested accent.

### Synced Workspace Data

1. Frontend API clients send `credentials: 'include'` and an anonymous client ID header.
2. Express resolves session identity and selects the effective client data space.
3. Routes validate input and call `StudyStore` operations.
4. The production SQLite store executes the domain transition and persists changed rows transactionally.

### Study Round

1. Starting a round queries only candidate `wordbook_words.id` values. New cards use word order plus the `study_states` level projection; review cards use the indexed due time and retain the protected/regular/backlog rules.
2. The durable round and its ordered tasks are separate rows. Resuming reads that queue; `currentWord` remains a response-only value derived from the first task id.
3. Answering uses client-scoped copy-on-write in the domain layer, then atomically appends the small `study_events` row, upserts that word's `study_states` projection, and changes only the affected round/task/operation rows.
4. `(client_id, wordbook_id, wordbook_words.id)` is the stable learning identity even when spelling or entry content changes. `dictionary_entries.id` is a separate immutable content identity, and private edits stay scoped to one wordbook link.
5. Multiple store processes use an optimistic generation check inside the SQLite write transaction. A stale transition reloads and retries as a whole, so event order, state projections, and answer idempotency remain atomic.

## Cross-Package Invariants

- Network access stays in frontend data adapters; routes stay above backend stores.
- Backend input validation and frontend response parsing form the API contract and change together.
- `normalizeWord` and query validation intentionally exist in both packages. `resources/normalize-contract.json` and tests prevent divergence.
- Runtime configuration is parsed in `backend/src/config.ts`; new settings must remain aligned with environment examples and deployment configuration.
- Current code and tests are authoritative.
