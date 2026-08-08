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
- Zustand `wordbookStore.ts` persists the legacy/local wordbook to `localStorage`.
- Synced personal wordbooks, study progress, marketplace data, collaboration, and account operations flow through `WorkspaceApi` and the backend.
- Browser storage also holds anonymous client identity, preferences, and bounded caches. The session cookie—not stored client identity—is the authentication credential.

## Backend

- `backend/src/server.ts` is the production composition root. It loads validated configuration, creates providers/rate limiters/stores, starts the app, performs readiness checks, and closes resources on shutdown.
- `backend/src/app.ts` owns Express middleware and `/api` routes. Dependencies enter through `createApp` options so tests can inject controlled implementations.
- `backend/src/study/validation.ts` parses untrusted study, wordbook, marketplace, and collaboration inputs before domain operations run.
- `backend/src/study/types.ts` defines the backend domain/store contract; `store.ts` contains domain behavior and compatibility stores; `sqlite-store.ts` supplies production persistence.
- `backend/src/auth.ts` owns password hashing, session tokens, and cookie utilities; `authorization.ts` maps roles to capabilities.
- `backend/src/engagement/store.ts` isolates search analytics, feedback, site settings, messages, and message notifications behind an engagement-store interface.
- `backend/src/words/` contains normalization, provider-facing types, caching, and lookup service logic. `providers/` contains local SQLite and remote WiktApi adapters.

## Primary Data Flows

### Dictionary Lookup

1. UI code calls a repository in `frontend/src/data/`.
2. Express validates and normalizes the query, then applies lookup rate limits.
3. The word service checks its bounded in-process cache.
4. The production provider queries the generated local dictionary first and optionally falls back to WiktApi.
5. The frontend validates the response DTO before exposing it to components.

### Synced Workspace Data

1. Frontend API clients send `credentials: 'include'` and an anonymous client ID header.
2. Express resolves session identity and selects the effective client data space.
3. Routes validate input and call `StudyStore` operations.
4. The production SQLite store executes the domain transition and persists changed rows transactionally.

## Cross-Package Invariants

- Network access stays in frontend data adapters; routes stay above backend stores.
- Backend input validation and frontend response parsing form the API contract and change together.
- `normalizeWord` and query validation intentionally exist in both packages. `resources/normalize-contract.json` and tests prevent divergence.
- Runtime configuration is parsed in `backend/src/config.ts`; new settings must remain aligned with environment examples and deployment configuration.
- Current code and tests are authoritative.
