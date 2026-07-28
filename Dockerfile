# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the frontend (Vite -> frontend/dist)
# ---------------------------------------------------------------------------
FROM node:22.23.1-alpine3.23 AS frontend-build
WORKDIR /app/frontend

# Install deps first for better layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy the rest of the frontend source. .env.production (VITE_API_BASE=/) must
# be part of the build context so `vite build` bakes the same-origin API base.
COPY frontend/ ./
# `tsc -b` typechecks src/** including the normalize contract test, which imports
# ../../../resources/normalize-contract.json — mirror it to /app so the path resolves.
COPY resources/normalize-contract.json /app/resources/normalize-contract.json
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: build the backend (tsc -> backend/dist) + prune to runtime deps
# ---------------------------------------------------------------------------
FROM node:22.23.1-alpine3.23 AS backend-build
WORKDIR /app/backend

# better-sqlite3 normally downloads a musl prebuild. Keep a native-build
# fallback in this disposable stage so a missing architecture prebuild does not
# make production images unreproducible.
RUN apk add --no-cache python3 make g++ git

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./
COPY resources/ /app/resources/
RUN npm run dictionaries:build \
    && npm run build \
    && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 3: minimal runtime image
# ---------------------------------------------------------------------------
FROM node:22.23.1-alpine3.23 AS runtime

# Repo-relative layout preserved inside the image so the compiled backend can
# resolve ../../../resources from backend/dist/study and serve the frontend.
#   /app/backend/{dist,node_modules,package.json}
#   /app/frontend/dist
#   /app/resources
# WORKDIR /app first so the ./ destinations below resolve under /app.
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/package.json ./backend/package.json
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY resources/ ./resources/
COPY --from=backend-build /app/resources/dictionaries/generated ./resources/dictionaries/generated

WORKDIR /app/backend

ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/frontend/dist

# SQLite state lives here (DATABASE_FILE default ./data/study-state.sqlite).
# DATA_FILE points at the legacy JSON source imported once on first startup.
# Both paths are relative to this WORKDIR and owned by the unprivileged node user.
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
VOLUME ["/app/backend/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
