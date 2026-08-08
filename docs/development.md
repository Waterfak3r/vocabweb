# Development and Operations

## Prerequisites

- Node.js `>=22.12 <25` and npm.
- System Chrome/Chromium for browser E2E, or set `PLAYWRIGHT_CHROME_PATH`/`CHROME_PATH`.
- Docker and Docker Compose only for container builds or deployment checks.

The root, frontend, and backend each have their own `package.json` and lockfile. Install all three from the repository root:

```sh
npm ci
npm run install:all
```

Use `npm ci` rather than `npm install` for verification and reproducible setup.

## Local Development

Run the packages in separate terminals:

```sh
npm run dev --prefix backend
npm run dev --prefix frontend
```

The backend defaults to port `3000`; Vite defaults to `5173` and proxies `/api` to the backend. Backend defaults are defined and validated in `backend/src/config.ts`. Copy `backend/.env.example` to `backend/.env` only when local overrides are needed.

Relevant configuration:

- `frontend/.env.development` and `.env.production` keep `VITE_API_BASE=/` for same-origin API access.
- `backend/.env.example` documents server, database, dictionary, rate-limit, capacity, CORS, and proxy settings.
- `frontend/vite.config.ts` defines the development proxy.
- `Dockerfile`, `docker-compose.yml`, and `Caddyfile` define the production container topology.

## Build and Production Run

```sh
npm run build
npm start
```

The root build generates the local dictionary, builds `frontend/dist`, and compiles `backend/dist`. `npm start` checks both build outputs, starts the backend from `backend/`, and sets `STATIC_DIR` so Express serves the SPA.

To preview only the Vite build, use `npm run preview --prefix frontend`.

## Tests and Typechecks

Standard repository verification:

```sh
npm run typecheck --prefix backend
npm run typecheck --prefix frontend
npm test
```

- Backend tests use Node's test runner with `tsx` and live under `backend/test/`.
- Frontend tests use Vitest and are colocated as `*.test.ts` or `*.test.tsx` under `frontend/src/`.
- `npm test` at the root runs both package suites.
- CI additionally audits production dependencies, builds the frontend, builds the Docker image, and checks container readiness.

Run the narrowest relevant test first during iteration, then the affected package suite. Use the root build when a change crosses packages, changes dictionary resources, or affects production startup.

## Browser E2E

Browser flows require installed root dependencies and completed frontend/backend builds:

```sh
npm run build
npm run test:e2e:community-account
npm run test:e2e:collaboration
```

The scripts locate system Chrome, allocate a temporary port and data directory, start the built production server, exercise real browser flows, and clean up afterward. The community/account flow runs in CI; the collaboration flow is available for focused regression testing.

Optional screenshot output is controlled by `ACCOUNT_VISUAL_CAPTURE` and `COLLAB_VISUAL_CAPTURE`.

## Docker and Deployment

Build and start the Compose stack:

```sh
docker compose up -d --build
```

The application container runs read-only except for the `vacab-data` volume and temporary storage. Caddy terminates HTTP/HTTPS and proxies to the internal app port. Readiness is exposed at `/api/health/ready`.

Production settings belong in the root `.env`; see `README.md` for DNS, TLS, administrator initialization, backup, and deployment details. Prefer `docker compose down` to stop services. Do not use `docker compose down -v` unless deleting application data and Caddy state is intentional.

## Verification by Change Type

- Frontend-only logic/UI: focused Vitest, frontend typecheck, frontend test suite; add a build for route/chunk/style changes.
- Backend route/domain change: focused Node test, backend typecheck, backend test suite.
- API contract change: both package typechecks/tests and the relevant browser flow.
- Database or migration change: SQLite store tests, backup/upgrade reasoning, full backend suite, and senior review.
- Authentication/session change: auth and integration tests, community/account E2E, production proxy/cookie review, and senior review.
- Documentation-only change: validate links, paths, commands, and consistency; code tests are unnecessary unless documentation generation is involved.
