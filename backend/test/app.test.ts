import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp, type CreateAppOptions } from "../src/app.js";
import { FixedWindowRateLimiter } from "../src/http/rate-limit.js";
import { WordProviderError, type WordEntry } from "../src/words/types.js";
import { MemoryEngagementStore } from "../src/engagement/store.js";

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

function resilientEntry(): WordEntry {
  return {
    word: "resilient",
    phonetic: "/rɪˈzɪliənt/",
    audioUrl: "https://audio.example/en-gb/resilient.mp3",
    meanings: [
      {
        pos: "adjective",
        definition: "Able to recover quickly.",
        example: "A resilient community rebuilt.",
      },
    ],
    source: "backend",
  };
}

test("GET /api/health returns service status", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "vacabweb-backend",
    });
  } finally {
    await server.close();
  }
});

test("responses include browser hardening headers without advertising Express", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("strict-transport-security"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    await server.close();
  }
});

test("production security adds HSTS", async () => {
  const server = await startServer({ productionSecurity: true });
  try {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  } finally {
    await server.close();
  }
});

test("liveness remains available while readiness reports dependency failures", async () => {
  const server = await startServer({
    readinessCheck: async () => { throw new Error("database unavailable"); },
  });
  try {
    assert.equal((await fetch(`${server.baseUrl}/api/health/live`)).status, 200);
    const ready = await fetch(`${server.baseUrl}/api/health/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json() as { error: { code: string } }).error.code, "NOT_READY");
    assert.equal((await fetch(`${server.baseUrl}/api/health`)).status, 503);
  } finally {
    await server.close();
  }
});

test("search reporting and feedback expose stable public API contracts", async () => {
  const engagementStore = new MemoryEngagementStore();
  const server = await startServer({ engagementStore });
  try {
    for (const word of ["Resilient", "resilient", "feasible"]) {
      const response = await fetch(`${server.baseUrl}/api/searches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word }),
      });
      assert.equal(response.status, 204);
    }
    const popular = await fetch(`${server.baseUrl}/api/searches/popular?days=7&limit=8`);
    assert.equal(popular.status, 200);
    assert.deepEqual(await popular.json(), [
      { word: "resilient", count: 2 },
      { word: "feasible", count: 1 },
    ]);

    const feedback = await fetch(`${server.baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "bug", message: "  卡片按钮错位  ", contact: "tester", page: "/wordbook" }),
    });
    assert.equal(feedback.status, 201);
    assert.equal(engagementStore.feedback[0]?.message, "卡片按钮错位");

    const invalid = await fetch(`${server.baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "unknown", message: "" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await server.close();
  }
});

test("public message routes support guest threads, editing, and soft deletion", async () => {
  const engagementStore = new MemoryEngagementStore();
  const server = await startServer({ engagementStore });
  const headers = { "content-type": "application/json", "X-Vocab-Client-Id": "guest-client-123" };
  try {
    const rootResponse = await fetch(`${server.baseUrl}/api/messages`, {
      method: "POST", headers, body: JSON.stringify({ nickname: "学习者", content: "第一条留言" }),
    });
    assert.equal(rootResponse.status, 201);
    const root = await rootResponse.json() as { id: string };
    const replyResponse = await fetch(`${server.baseUrl}/api/messages`, {
      method: "POST", headers, body: JSON.stringify({ nickname: "学习者", content: "补充回复", parentId: root.id }),
    });
    assert.equal(replyResponse.status, 201);
    const listing = await fetch(`${server.baseUrl}/api/messages?limit=20`, { headers });
    assert.equal(listing.status, 200);
    assert.equal(((await listing.json()) as { items: unknown[] }).items.length, 2);
    const edited = await fetch(`${server.baseUrl}/api/messages/${root.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ content: "修改后的留言" }),
    });
    assert.equal(edited.status, 200);
    const deleted = await fetch(`${server.baseUrl}/api/messages/${root.id}`, { method: "DELETE", headers });
    assert.equal(deleted.status, 204);
    const after = await engagementStore.listMessages({ clientId: "guest-client-123" }, undefined, 20);
    assert.equal(after.items.find((item) => item.id === root.id)?.status, "deleted");
  } finally {
    await server.close();
  }
});

test("unknown routes return the shared 404 response", async () => {
  const server = await startServer();
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

test("invalid JSON retains the shared 400 response", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/unknown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON",
      },
    });
  } finally {
    await server.close();
  }
});

test("GET /api/words/:word returns the exact normalized DTO", async () => {
  const lookedUp: string[] = [];
  const server = await startServer({
    wordLookup: {
      async lookup(word) {
        lookedUp.push(word);
        return resilientEntry();
      },
    },
    frontendOrigins: ["https://frontend.example"],
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/words/RESILIENT`, {
      headers: { origin: "https://frontend.example" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://frontend.example");
    assert.deepEqual(await response.json(), resilientEntry());
    assert.deepEqual(lookedUp, ["resilient"]);
  } finally {
    await server.close();
  }
});

test("GET /api/pronunciations/:word returns recorded audio from its dedicated lookup", async () => {
  const lookedUp: string[] = [];
  const server = await startServer({
    wordLookup: { async lookup() { return resilientEntry(); } },
    pronunciationLookups: {
      gb: {
        async lookup(word) {
          lookedUp.push(`gb:${word}`);
          return {
            word, phonetic: "/steɪt/", audioUrl: "https://audio.example/en-gb/state.mp3",
            meanings: [{ pos: "noun", definition: "A condition." }], source: "backend",
          };
        },
      },
      us: {
        async lookup(word) {
          lookedUp.push(`us:${word}`);
          return {
            word, phonetic: "/steɪt/", audioUrl: "https://audio.example/en-us/state.mp3",
            meanings: [{ pos: "noun", definition: "A condition." }], source: "backend",
          };
        },
      },
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/pronunciations/STATE`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
    assert.deepEqual(await response.json(), {
      word: "state",
      accent: "gb",
      phonetic: "/steɪt/",
      audioUrl: "https://audio.example/en-gb/state.mp3",
    });
    const american = await fetch(`${server.baseUrl}/api/pronunciations/state?accent=us`);
    assert.equal(american.status, 200);
    assert.equal((await american.json() as { audioUrl: string }).audioUrl, "https://audio.example/en-us/state.mp3");
    assert.equal((await fetch(`${server.baseUrl}/api/pronunciations/state?accent=au`)).status, 400);
    assert.deepEqual(lookedUp, ["gb:state", "us:state"]);
  } finally {
    await server.close();
  }
});

test("CORS rejects origins outside the configured allowlist", async () => {
  const server = await startServer({
    frontendOrigins: ["https://frontend.example"],
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "https://untrusted.example" },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), {
      error: {
        code: "CORS_ORIGIN_DENIED",
        message: "Origin is not allowed",
      },
    });
  } finally {
    await server.close();
  }
});

test("invalid and empty word queries return 400 without calling the lookup", async (context) => {
  let calls = 0;
  const server = await startServer({
    wordLookup: {
      async lookup() {
        calls += 1;
        return resilientEntry();
      },
    },
  });

  try {
    for (const path of [
      "/api/words",
      "/api/words/",
      "/api/words/test123",
      "/api/words/hello%2Fworld",
    ]) {
      await context.test(path, async () => {
        const response = await fetch(`${server.baseUrl}${path}`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: { code: "INVALID_WORD", message: "Word query is invalid" },
        });
      });
    }

    await context.test("malformed URL encoding", async () => {
      const response = await fetch(`${server.baseUrl}/api/words/%E0%A4%A`);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: { code: "INVALID_WORD", message: "Word query is invalid" },
      });
    });

    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("GET /api/words/:word accepts normalized phrases", async () => {
  const server = await startServer({
    wordLookup: {
      async lookup(word) {
        return { word, phonetic: "", meanings: [{ pos: "phrase", definition: "a large amount" }], source: "backend" };
      },
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/words/a%20%20lot%20of`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { word: string }).word, "a lot of");
  } finally {
    await server.close();
  }
});

test("GET /api/words/suggestions validates, normalizes, caches, and uses its own limiter", async () => {
  const calls: Array<{ query: string; limit: number }> = [];
  const server = await startServer({
    wordSuggestionLookup: {
      async suggest(query, limit) {
        calls.push({ query, limit });
        return [{ word: "a lot of", zhMeaning: "许多", kind: "phrase" }];
      },
    },
    wordSuggestionRateLimiter: new FixedWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
    }),
    wordRateLimiter: new FixedWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
    }),
    wordLookup: { async lookup() { return resilientEntry(); } },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/words/suggestions?q=%20A%20%20LOT&limit=6`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.deepEqual(await response.json(), {
      suggestions: [{ word: "a lot of", zhMeaning: "许多", kind: "phrase" }],
    });
    assert.deepEqual(calls, [{ query: "a lot", limit: 6 }]);

    const invalid = await fetch(`${server.baseUrl}/api/words/suggestions?q=a&limit=8`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, "INVALID_SUGGESTION_QUERY");

    const limited = await fetch(`${server.baseUrl}/api/words/suggestions?q=lot&limit=8`);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as { error: { code: string } }).error.code, "RATE_LIMITED");

    const lookup = await fetch(`${server.baseUrl}/api/words/resilient`);
    assert.equal(lookup.status, 200);
  } finally {
    await server.close();
  }
});

test("GET /api/words/suggestions without q remains an exact headword lookup", async () => {
  const server = await startServer({
    wordLookup: {
      async lookup(word) {
        return { word, phonetic: "", meanings: [{ pos: "noun", definition: "proposals" }], source: "backend" };
      },
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/words/suggestions`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { word: string }).word, "suggestions");
  } finally {
    await server.close();
  }
});

test("GET /api/words/suggestions accepts 2–24 Chinese characters without English normalization", async () => {
  const calls: Array<{ query: string; limit: number }> = [];
  const server = await startServer({
    wordSuggestionLookup: {
      async suggest(query, limit) {
        calls.push({ query, limit });
        return [{ word: "give up", zhMeaning: "放弃", kind: "phrase" }];
      },
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/words/suggestions?q=${encodeURIComponent("  放弃  ")}&limit=8`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      suggestions: [{ word: "give up", zhMeaning: "放弃", kind: "phrase" }],
    });
    assert.deepEqual(calls, [{ query: "放弃", limit: 8 }]);

    const tooLong = "中".repeat(25);
    assert.equal((await fetch(`${server.baseUrl}/api/words/suggestions?q=${tooLong}`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/api/words/suggestions?q=${encodeURIComponent("放 a")}`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/api/words/suggestions?q=ab&limit=9`)).status, 400);
  } finally {
    await server.close();
  }
});

test("GET /api/words/:word maps a miss to WORD_NOT_FOUND", async () => {
  const server = await startServer({
    wordLookup: { async lookup() { return null; } },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/words/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "WORD_NOT_FOUND", message: "Word was not found" },
    });
  } finally {
    await server.close();
  }
});

test("GET /api/words/:word maps provider failures to stable API errors", async (context) => {
  for (const expectation of [
    { code: "UPSTREAM_ERROR" as const, status: 502 },
    { code: "UPSTREAM_PARSE_ERROR" as const, status: 502 },
    { code: "UPSTREAM_TIMEOUT" as const, status: 504 },
  ]) {
    await context.test(expectation.code, async () => {
      const server = await startServer({
        wordLookup: {
          async lookup() {
            throw new WordProviderError(expectation.code, "private provider detail");
          },
        },
      });

      try {
        const response = await fetch(`${server.baseUrl}/api/words/test`);
        assert.equal(response.status, expectation.status);
        assert.deepEqual(await response.json(), {
          error: {
            code: expectation.code,
            message: "Dictionary provider is unavailable",
          },
        });
      } finally {
        await server.close();
      }
    });
  }
});

test("unexpected lookup errors retain the shared 500 response", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  const server = await startServer({
    wordLookup: {
      async lookup() {
        throw new Error("unexpected");
      },
    },
  });

  try {
    const response = await fetch(`${server.baseUrl}/api/words/test`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  } finally {
    console.error = originalConsoleError;
    await server.close();
  }
});

test("word lookup rate limiting is scoped to the word route", async () => {
  const server = await startServer({
    wordLookup: { async lookup() { return resilientEntry(); } },
    wordRateLimiter: new FixedWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
    }),
  });

  try {
    const first = await fetch(`${server.baseUrl}/api/words/resilient`);
    assert.equal(first.status, 200);

    const health = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(health.status, 200);

    const limited = await fetch(`${server.baseUrl}/api/words/resilient`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.deepEqual(await limited.json(), {
      error: {
        code: "RATE_LIMITED",
        message: "Too many word lookup requests",
      },
    });
  } finally {
    await server.close();
  }
});
