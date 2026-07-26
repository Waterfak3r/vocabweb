import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp, type CreateAppOptions } from "../src/app.js";

interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function startServer(options: CreateAppOptions = {}): Promise<TestServer> {
  const server: Server = createApp(options).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const INDEX_HTML = '<!doctype html><title>__VACAB_SPA_INDEX__</title><div id="root"></div>';
const ASSET_JS = 'globalThis.__vacabAsset = "app-abc123";';

let staticDir: string;

before(async () => {
  staticDir = await mkdtemp(path.join(tmpdir(), "vacab-static-"));
  await writeFile(path.join(staticDir, "index.html"), INDEX_HTML, "utf8");
  const assetsDir = path.join(staticDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(assetsDir, "app-abc123.js"), ASSET_JS, "utf8");
});

after(async () => {
  if (staticDir) {
    await rm(staticDir, { recursive: true, force: true });
  }
});

test("GET / serves index.html with a no-cache policy", async () => {
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(await response.text(), INDEX_HTML);
  } finally {
    await server.close();
  }
});

test("GET /assets/* serves hashed assets with an immutable cache policy", async () => {
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/assets/app-abc123.js`);

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(await response.text(), ASSET_JS);
  } finally {
    await server.close();
  }
});

test("GET /wordbook deep links fall back to index.html", async () => {
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/wordbook`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(await response.text(), INDEX_HTML);
  } finally {
    await server.close();
  }
});

test("GET /api/unknown still returns the JSON 404 while static serving is enabled", async () => {
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/api/unknown`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } finally {
    await server.close();
  }
});

test("same-origin API requests are allowed even outside the CORS allowlist", async () => {
  // No frontendOrigins override, so the default localhost:5173 allowlist applies;
  // the random test port is not in it, proving the same-origin branch is what allows it.
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: server.baseUrl },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), server.baseUrl);
  } finally {
    await server.close();
  }
});

test("cross-origin API requests outside the allowlist are rejected", async () => {
  const server = await startServer({ staticDir });
  try {
    const response = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "http://evil.example" },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), {
      error: { code: "CORS_ORIGIN_DENIED", message: "Origin is not allowed" },
    });
  } finally {
    await server.close();
  }
});

test("without a static dir, non-API routes keep returning the JSON 404", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/wordbook`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } finally {
    await server.close();
  }
});
