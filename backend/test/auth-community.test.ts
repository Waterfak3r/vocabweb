import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp, type CreateAppOptions } from "../src/app.js";
import { FixedWindowRateLimiter } from "../src/http/rate-limit.js";
import { BaseStore, InMemoryStudyStore, type State } from "../src/study/store.js";

const ALICE_CLIENT = "client-alice-0001";
const BOB_CLIENT = "client-bob-000001";
const ANON_CLIENT = "client-anon-00001";

class InspectableStore extends BaseStore {
  constructor(public data: State) { super(); }
  protected async load() { return this.data; }
  protected async save(state: State) { this.data = state; }
}

async function fixture(options: CreateAppOptions = {}) {
  const store = options.studyStore ?? new InMemoryStudyStore();
  const server: Server = createApp({ ...options, studyStore: store }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const jsonHeaders = (clientId: string, cookie?: string) => ({
  "content-type": "application/json",
  "x-vocab-client-id": clientId,
  ...(cookie ? { cookie } : {}),
});

async function register(baseUrl: string, clientId: string, username: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: jsonHeaders(clientId),
    body: JSON.stringify({ username, password: "password-123" }),
  });
  assert.equal(response.status, 201);
  return {
    user: await response.json() as { username: string; clientId: string },
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}

test("sessions override client headers, claimed ids require auth, and logout is idempotent", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    assert.deepEqual(alice.user, { username: "Alice", clientId: ALICE_CLIENT });

    const claimedWithoutCookie = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers: jsonHeaders(ALICE_CLIENT) });
    assert.equal(claimedWithoutCookie.status, 401);

    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers: jsonHeaders(BOB_CLIENT, alice.cookie),
      body: JSON.stringify({ title: "Alice data" }),
    });
    assert.equal(create.status, 201);
    assert.equal((await app.store.listMyWordbooks(ALICE_CLIENT, false)).length, 1);
    assert.equal((await app.store.listMyWordbooks(BOB_CLIENT, false)).length, 0);

    const me = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie: alice.cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { username: "Alice", clientId: ALICE_CLIENT });

    const firstLogout = await fetch(`${app.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: alice.cookie } });
    assert.equal(firstLogout.status, 204);
    assert.match(firstLogout.headers.get("set-cookie") ?? "", /Max-Age=0/);
    const repeatedLogout = await fetch(`${app.baseUrl}/api/auth/logout`, { method: "POST" });
    assert.equal(repeatedLogout.status, 204);
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie: alice.cookie } })).status, 401);

    const repeatedClient = await fetch(`${app.baseUrl}/api/auth/register`, {
      method: "POST", headers: jsonHeaders(ALICE_CLIENT),
      body: JSON.stringify({ username: "Another", password: "password-123" }),
    });
    assert.equal(repeatedClient.status, 409);
  } finally {
    await app.close();
  }
});

test("login merges only anonymous data, is repeat-safe, and rejects cross-account identities", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    const bob = await register(app.baseUrl, BOB_CLIENT, "Bob");
    await fetch(`${app.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: alice.cookie } });
    await fetch(`${app.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: bob.cookie } });
    await app.store.createMyWordbook(ANON_CLIENT, { title: "Anonymous work" });

    const login = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ username: "alice", password: "password-123" }),
    });
    assert.equal(login.status, 200);
    const aliceCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    assert.deepEqual((await app.store.listMyWordbooks(ALICE_CLIENT, false)).map((book) => book.title), ["Anonymous work"]);
    assert.deepEqual(await app.store.listMyWordbooks(ANON_CLIENT, false), []);

    const repeated = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ALICE_CLIENT),
      body: JSON.stringify({ username: "Alice", password: "password-123" }),
    });
    assert.equal(repeated.status, 200);
    assert.equal((await app.store.listMyWordbooks(ALICE_CLIENT, false)).length, 1);

    const claimedByBob = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(BOB_CLIENT),
      body: JSON.stringify({ username: "Alice", password: "password-123" }),
    });
    assert.equal(claimedByBob.status, 409);

    const activeSessionSwitch = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ALICE_CLIENT, aliceCookie),
      body: JSON.stringify({ username: "Bob", password: "password-123" }),
    });
    assert.equal(activeSessionSwitch.status, 409);
    assert.equal((await app.store.listMyWordbooks(ALICE_CLIENT, false)).length, 1);
    assert.equal((await app.store.listMyWordbooks(BOB_CLIENT, false)).length, 0);
  } finally {
    await app.close();
  }
});

test("community visibility keeps public direct, unlisted share-only, and private owner-only", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    const accountHeaders = jsonHeaders(ALICE_CLIENT, alice.cookie);
    const sourceResponse = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST", headers: accountHeaders,
      body: JSON.stringify({ title: "Source", words: [{ word: "resilient", phonetic: "", meanings: [], source: "user" }] }),
    });
    const source = await sourceResponse.json() as { id: string };

    const anonymousPublic = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ title: "No", visibility: "public", author: { username: "forged" }, words: [] }),
    });
    assert.equal(anonymousPublic.status, 401);

    const upload = async (visibility: "public" | "unlisted" | "private") => {
      const response = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
        method: "POST", headers: accountHeaders,
        body: JSON.stringify({ sourceWordbookId: source.id, visibility, author: { username: "forged" } }),
      });
      assert.equal(response.status, 201);
      return await response.json() as { id: string; author: string; shareCode: string; sourceWordbookId?: string };
    };
    const publicBook = await upload("public");
    const unlistedBook = await upload("unlisted");
    const privateBook = await upload("private");
    assert.equal(unlistedBook.shareCode.length, 24);
    assert.equal(publicBook.author, "Alice");
    assert.equal(publicBook.sourceWordbookId, source.id);
    const ownerUploads = await fetch(`${app.baseUrl}/api/catalog/uploads/mine`, { headers: accountHeaders });
    assert.ok((await ownerUploads.json() as Array<{ sourceWordbookId?: string }>).every((book) => book.sourceWordbookId === source.id));
    const invalidVisibility = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST", headers: accountHeaders,
      body: JSON.stringify({ sourceWordbookId: source.id, visibility: "friends", author: { username: "forged" } }),
    });
    assert.equal(invalidVisibility.status, 400);

    const publicList = await fetch(`${app.baseUrl}/api/catalog/wordbooks`, { headers: jsonHeaders(ANON_CLIENT) });
    assert.deepEqual((await publicList.json() as Array<{ id: string }>).map((book) => book.id), [publicBook.id]);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${publicBook.id}`, { headers: jsonHeaders(ANON_CLIENT) })).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${unlistedBook.id}`, { headers: jsonHeaders(ANON_CLIENT) })).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${privateBook.id}`, { headers: jsonHeaders(ANON_CLIENT) })).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${unlistedBook.id}/add`, { method: "POST", headers: jsonHeaders(ANON_CLIENT) })).status, 404);

    const unlistedImport = await fetch(`${app.baseUrl}/api/catalog/imports`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ shareCode: unlistedBook.shareCode }),
    });
    assert.equal(unlistedImport.status, 201);
    const repeatedImport = await fetch(`${app.baseUrl}/api/catalog/imports`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ shareCode: unlistedBook.shareCode }),
    });
    assert.equal(repeatedImport.status, 200);
    const privateImport = await fetch(`${app.baseUrl}/api/catalog/imports`, {
      method: "POST", headers: accountHeaders,
      body: JSON.stringify({ shareCode: privateBook.shareCode }),
    });
    assert.equal(privateImport.status, 404);

    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${privateBook.id}`, { headers: accountHeaders })).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${privateBook.id}`, { method: "DELETE", headers: jsonHeaders(ANON_CLIENT) })).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${publicBook.id}/favorite`, { method: "POST", headers: jsonHeaders(ANON_CLIENT) })).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${publicBook.id}`, {
      method: "PATCH", headers: accountHeaders, body: JSON.stringify({ visibility: "unlisted" }),
    })).status, 200);
    const retainedFavorite = await fetch(`${app.baseUrl}/api/catalog/favorites`, { headers: jsonHeaders(ANON_CLIENT) });
    assert.deepEqual((await retainedFavorite.json() as Array<{ id: string }>).map((book) => book.id), [publicBook.id]);
    assert.deepEqual(await (await fetch(`${app.baseUrl}/api/catalog/wordbooks/${publicBook.id}/favorite`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
    })).json(), { favorited: false });
    const anonymousMakePublic = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${unlistedBook.id}`, {
      method: "PATCH", headers: jsonHeaders(ALICE_CLIENT),
      body: JSON.stringify({ visibility: "public" }),
    });
    assert.equal(anonymousMakePublic.status, 401);
  } finally {
    await app.close();
  }
});

test("login uses an independent IP rate limit", async () => {
  const app = await fixture({
    loginRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }),
    mutationRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 100 }),
  });
  try {
    const first = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ username: "Nobody", password: "password-123" }),
    });
    assert.equal(first.status, 401);
    const second = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ username: "Nobody", password: "password-123" }),
    });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
  } finally {
    await app.close();
  }
});

test("registration shares the stricter authentication rate limit", async () => {
  const app = await fixture({
    loginRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 1 }),
    mutationRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 100 }),
  });
  try {
    const first = await fetch(`${app.baseUrl}/api/auth/register`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ username: "First", password: "password-123" }),
    });
    assert.equal(first.status, 201);
    const second = await fetch(`${app.baseUrl}/api/auth/register`, {
      method: "POST", headers: jsonHeaders("client-auth-rate-0002"),
      body: JSON.stringify({ username: "Second", password: "password-123" }),
    });
    assert.equal(second.status, 429);
  } finally {
    await app.close();
  }
});

test("authentication crypto work has a global concurrency ceiling", async () => {
  const app = await fixture({
    loginRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 100 }),
    mutationRateLimiter: new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 100 }),
  });
  try {
    const attempts = await Promise.all(Array.from({ length: 5 }, () => fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ username: "Nobody", password: "password-123" }),
    })));
    assert.deepEqual(attempts.map((response) => response.status).sort(), [401, 401, 401, 401, 503]);
  } finally {
    await app.close();
  }
});

test("client merge remaps colliding book, word, and event ids with references intact", async () => {
  const store = new InspectableStore({ version: 3, catalog: [], clients: {}, users: [], sessions: [] });
  const entry = { word: "resilient", phonetic: "", meanings: [], source: "user" as const };
  const targetBook = await store.createMyWordbook(ALICE_CLIENT, { title: "Target", words: [entry] });
  const sourceBook = await store.createMyWordbook(ANON_CLIENT, { title: "Source", words: [entry] });
  const targetWord = (await store.listWords(ALICE_CLIENT, targetBook.id))![0]!;
  const sourceWord = (await store.listWords(ANON_CLIENT, sourceBook.id))![0]!;
  await store.recordEvent(ALICE_CLIENT, { kind: "flashcard", wordbookId: targetBook.id, wordId: targetWord.id, verdict: "know" });
  await store.recordEvent(ANON_CLIENT, { kind: "flashcard", wordbookId: sourceBook.id, wordId: sourceWord.id, verdict: "know" });

  const source = store.data.clients[ANON_CLIENT]!;
  const target = store.data.clients[ALICE_CLIENT]!;
  source.wordbooks[0]!.id = target.wordbooks[0]!.id;
  source.wordbooks[0]!.words[0]!.id = target.wordbooks[0]!.words[0]!.id;
  source.events[0]!.wordbookId = target.wordbooks[0]!.id;
  source.events[0]!.wordId = target.wordbooks[0]!.words[0]!.id;
  source.events[0]!.id = target.events[0]!.id;

  await store.mergeClients(ANON_CLIENT, ALICE_CLIENT);
  const merged = store.data.clients[ALICE_CLIENT]!;
  assert.equal(new Set(merged.wordbooks.map((book) => book.id)).size, 2);
  assert.equal(new Set(merged.wordbooks.flatMap((book) => book.words.map((word) => word.id))).size, 2);
  assert.equal(new Set(merged.events.map((event) => event.id)).size, 2);
  for (const event of merged.events) {
    const book = merged.wordbooks.find((item) => item.id === event.wordbookId);
    assert.ok(book?.words.some((word) => word.id === event.wordId));
  }
  assert.equal(store.data.clients[ANON_CLIENT], undefined);
});
