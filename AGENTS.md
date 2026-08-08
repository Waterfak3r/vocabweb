# Vacabweb Agent Guide

## Project Overview
- Vacabweb is a local-first English dictionary and vocabulary-learning web app with accounts, synced study data, wordbook sharing, collaboration, and messages.
- Application packages are React 19 + Vite 8 + Zustand in `frontend/` and Express 5 + strict TypeScript + SQLite in `backend/`; the root npm package orchestrates builds and E2E tests.
- Node.js `>=22.12 <25` is required. Development uses Vite `5173` plus Express `3000`; production is a same-origin Express-served SPA, optionally behind Caddy.

## Repository Structure
- `frontend/` — browser UI, routes, client state, API adapters, domain utilities, styles, and colocated Vitest tests.
- `backend/` — API server, authentication, domain/store logic, dictionary providers, SQLite persistence, CLIs, and Node tests.
- `resources/` — dictionary source metadata/samples and cross-package normalization contract data.
- `scripts/` and `.github/` — production/E2E launchers, CI, image publishing, and deployment automation.
- `docs/` — stable architecture, database, API, and development references; `README.md` remains the operator quick start.

## Development Workflow
- Install: `npm ci && npm run install:all`.
- Develop in two terminals: `npm run dev --prefix backend` and `npm run dev --prefix frontend`.
- Build/start production: `npm run build` then `npm start`.
- Verify: `npm run typecheck --prefix backend`, `npm run typecheck --prefix frontend`, then `npm test`.
- Browser E2E and deployment procedures are documented in `docs/development.md`.

## Architecture Rules
- Browser network access belongs in `frontend/src/data/`; UI code consumes typed adapters rather than calling `fetch` directly.
- Same-origin HttpOnly sessions are the account credential; `X-Vocab-Client-Id` partitions anonymous data and is never authentication.
- Durable state stays behind backend store interfaces; routes must not access SQLite directly.
- API changes require coordinated backend validation/types, frontend runtime parsers/types, and contract tests; preserve the `{ error: { code, message } }` envelope.
- Keep both `normalizeWord` implementations and `resources/normalize-contract.json` synchronized.
- Read `docs/architecture.md`, `docs/database.md`, or `docs/api.md` before changing the corresponding boundary.

## Coding Guidelines
- Match package conventions: backend NodeNext imports use `.js`, double quotes, and semicolons; frontend uses extensionless imports, single quotes, and no semicolons.
- Reuse `frontend/src/components/ui/` and `frontend/src/styles/tokens.css`; follow the feature's existing global CSS or CSS-module pattern.
- Add dependencies only to the package that uses them and update that package's lockfile.
- Preserve API behavior, persisted formats, session semantics, and migration compatibility unless the task explicitly coordinates a breaking change.

## Agent Behavior
- Inspect current code, tests, call sites, documentation, and working-tree changes before editing; code and tests are authoritative.
- Prefer the smallest scoped change; never rewrite unrelated code or overwrite pre-existing user changes.
- Run targeted tests first, then the affected package typecheck/tests; run the root build for cross-package or deployment-facing work.
- Surface ambiguity and data/security/compatibility risks instead of guessing.

## Agent Escalation
- Default: implement normal, well-scoped tasks directly with the least expensive capable agent.
- Request senior review for database schema/migration changes, authentication/session changes, API contract changes, large refactors, or unclear architecture decisions.
- Use deeper reasoning only when behavior spans packages, persistence, concurrency, security, or backward compatibility.
- Do not escalate formatting, small UI adjustments, routine CRUD, narrow tests, or documentation-only updates.
- Consult the relevant `docs/` reference before escalating; explain the unresolved risk and proposed decision.

## Agent Team Configuration (Herdr)

This project runs inside **Herdr**. The main agent is **Codex**; coordination happens through the `herdr` CLI (see the Herdr skill). Know your own stack and how to delegate.

### Model layout
| Role | Agent | Model | Notes |
|---|---|---|---|
| Main agent | Codex (you) | `gpt-5.6-sol`, reasoning `max` | Configured in `~/.codex/config.toml`; do not change it |
| Subagents (Codex) | Codex subagents | `gpt-5.6-luna` | Default via `default_subagent_model`; override per task with `/model` when a task needs heavier reasoning |
| Assistant agent | Claude Code | `deepseek-v4-flash` via local proxy | Runs in a Herdr pane started with `herdr agent start ... --kind claude`; inherits `ANTHROPIC_BASE_URL` from `~/.claude/settings.json` |

### Division of labor
- **You (Codex sol max)**: own the plan and the coordination. Design the approach, split work, integrate results, and decide final calls. Implement directly only when the plan is so intricate that handing it off costs more than writing it.
- **Codex subagents (luna)**: the implementers. Give each a well-scoped implementation task with acceptance criteria and an output path; they write the code, you review and integrate.
- **Claude Code (deepseek)**: delegate repetitive or independent work that suits a separate agent: frontend styling passes, cross-checking, mechanical rewrites, review sweeps, parallel experiments.

### Coordination rules
- Start another agent only through Herdr: `herdr agent start <name> --kind claude --pane <pane-id>`; never spawn terminals behind the user's back.
- Delegate only well-specified tasks with clear acceptance criteria and an output path; agents cannot read each other's context, so write the task down.
- Check results with `herdr agent wait <name> --until idle` then `herdr agent read <name>`; surface anything unexpected to the user.
- You are the integrator: merge, reconcile, and report. Do not offload coordination or final decisions to subagents.
- If a subagent reports a blocking issue, take it over yourself instead of bouncing it back.
