# API Contracts

## Transport

- All application endpoints live under `/api` and use JSON except empty responses and pronunciation audio.
- Development uses `frontend/vite.config.ts` to proxy `/api` to `127.0.0.1:3000`; committed frontend environments set `VITE_API_BASE=/`.
- Production serves the SPA and API from one origin. Frontend API clients include `credentials: 'include'` for session cookies.
- Additional development origins are controlled by `FRONTEND_ORIGIN`, but cross-origin configuration does not replace the same-site session design.

Frontend network calls belong in `frontend/src/data/`. URL construction uses `resolveApiBase`, and response bodies are treated as `unknown` until runtime parsers validate them.

## Contract Ownership

- Express routes and middleware are centralized in `backend/src/app.ts`.
- Study/workspace request parsing belongs in `backend/src/study/validation.ts`; authentication inputs are parsed in `backend/src/auth.ts`.
- Backend domain and store DTOs live primarily in `backend/src/study/types.ts` and `backend/src/words/types.ts`.
- Frontend response types and parsers live with their clients, especially `workspaceApi.ts`, `backendWordRepository.ts`, and `engagementApi.ts`.
- There is no generated shared API package. Any contract change must update both sides and their tests in one coordinated change.

## Errors and Status Codes

API errors use the stable JSON envelope:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Human-readable message"
  }
}
```

Keep existing HTTP status meanings and machine error codes backward compatible. Frontend clients distinguish expected results such as `401` or `404` from infrastructure failures and invalid payloads. New endpoints should follow adjacent route and parser tests rather than inventing a second error format.

## Authentication and Identity

- Passwords are stored as salted scrypt records. Password verification work is capacity-limited in the app.
- Login and registration create a cryptographically random session token. The browser receives the token in an HttpOnly cookie; SQLite stores only its SHA-256 hash.
- Session cookies use same-site behavior and become `Secure` under production security. Correct `TRUST_PROXY` configuration is required when HTTPS terminates at a proxy.
- `POST /api/auth/logout` revokes the current session and clears the cookie; account password changes revoke other sessions.
- `GET /api/auth/me` is the frontend's source of truth for signed-in state; an absent or expired session is anonymous.

`X-Vocab-Client-Id` is a browser-readable identifier for anonymous data partitioning, not a credential:

- without a valid session, it selects an unclaimed anonymous data space;
- with a valid session, the server always selects the account's bound client ID, regardless of the header;
- a client ID already claimed by an account cannot be reused anonymously;
- registration/login may merge eligible anonymous state into the account data space.

## Endpoint Families

- `/api/words` and `/api/pronunciations` — dictionary definitions, suggestions, and pronunciation metadata/audio.
- `/api/auth` and `/api/account` — session lifecycle, profile security, export, and deletion.
- `GET /api/account/profile` requires an active session and returns the account's 90-day study metrics, daily activity, streaks, and recent learning history. Its client identity is always taken from the session user, not `X-Vocab-Client-Id`.
- `/api/my` and `/api/study` — personal wordbooks, imports, preferences, dashboards, rounds, and learning events.
- `/api/catalog` and account contribution routes — public/unlisted wordbooks, favorites, publishing, revisions, contributions, merges, and reverts.
- search, feedback, site-setting, and message routes — engagement data and threaded communication.
- `/api/health/live`, `/api/health/ready`, and `/api/health` — process liveness and dependency readiness.

## Wordbook Change Model

- Personal wordbook edits save immediately; there is no extra commit step for ordinary add, edit, delete, or study actions.
- Imports are the exception: parsing creates a recoverable draft, and the explicit import commit applies either append or whole-wordbook overwrite semantics.
- Publishing creates an independent catalog snapshot. Later personal edits stay private until the publisher explicitly previews and publishes another snapshot.
- Collaborators edit their own joined copy, preview a three-way diff, and submit a contribution. Only the publisher can merge it; merge, publisher updates, and reverts append immutable catalog revisions instead of rewriting revision history.
- A public wordbook with open contributions cannot become unlisted or private. The API returns `CATALOG_OPEN_CONTRIBUTIONS` with the pending count so clients cannot silently close submitted work.
- Merge and revert may remove words from the publisher's current source wordbook. Historical learning events remain in account history and export, while active study rounds for that source are ended because they may reference removed words.
- Contribution and revision response DTOs omit internal account IDs and private source-wordbook IDs. Contributor-owned source IDs appear only in authenticated preview requests that need them.

## Changing a Contract

Before finishing an API change:

1. Preserve or explicitly version existing behavior.
2. Update backend validation, response construction, and store interfaces as needed.
3. Update frontend DTO types, runtime parsers, and API methods.
4. Add focused backend route/store tests and frontend client/parser tests.
5. Run both package typechecks and tests; run the browser flow when account, marketplace, collaboration, or session behavior changes.

Authentication, session, authorization, and breaking API changes require senior review.
