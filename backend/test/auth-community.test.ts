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
  const setCookie = response.headers.get("set-cookie")!;
  return {
    user: await response.json() as {
      username: string;
      clientId: string;
      role: "user" | "admin";
      createdAt: string;
      avatarUrl: string | null;
      capabilities: string[];
    },
    cookie: setCookie.split(";")[0]!,
    setCookie,
  };
}

test("sessions override client headers, claimed ids require auth, and logout is idempotent", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    assert.match(alice.user.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(alice.user, {
      username: "Alice",
      clientId: ALICE_CLIENT,
      role: "user",
      createdAt: alice.user.createdAt,
      avatarUrl: null,
      capabilities: [],
    });

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
    assert.equal(me.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await me.json(), {
      username: "Alice",
      clientId: ALICE_CLIENT,
      role: "user",
      createdAt: alice.user.createdAt,
      avatarUrl: null,
      capabilities: [],
    });

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

    const anonymousUpload = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST", headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ title: "No", visibility: "unlisted", author: { username: "forged" }, words: [] }),
    });
    assert.equal(anonymousUpload.status, 401);
    assert.equal((await anonymousUpload.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED_FOR_UPLOAD");

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
    })).json(), { favorited: false, favoriteCount: 0 });
    const anonymousMakePublic = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${unlistedBook.id}`, {
      method: "PATCH", headers: jsonHeaders(ALICE_CLIENT),
      body: JSON.stringify({ visibility: "public" }),
    });
    assert.equal(anonymousMakePublic.status, 401);
  } finally {
    await app.close();
  }
});

test("only administrators can configure the public donation image", async () => {
  const app = await fixture();
  try {
    const initial = await fetch(`${app.baseUrl}/api/site-settings`, { headers: jsonHeaders(ANON_CLIENT) });
    assert.deepEqual(await initial.json(), { donationImageUrl: null });

    const denied = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      method: "PATCH",
      headers: jsonHeaders(ANON_CLIENT),
      body: JSON.stringify({ donationImageUrl: "/images/reward.png" }),
    });
    assert.equal(denied.status, 403);

    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    const promoted = await app.store.setUserRole("Alice", "admin");
    assert.equal(promoted?.role, "admin");
    const accountHeaders = jsonHeaders(ALICE_CLIENT, alice.cookie);
    const saved = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      method: "PATCH",
      headers: accountHeaders,
      body: JSON.stringify({ donationImageUrl: "/images/reward.png" }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { donationImageUrl: "/images/reward.png" });
    assert.deepEqual(await (await fetch(`${app.baseUrl}/api/site-settings`)).json(), {
      donationImageUrl: "/images/reward.png",
    });

    const unsafe = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      method: "PATCH",
      headers: accountHeaders,
      body: JSON.stringify({ donationImageUrl: "javascript:alert(1)" }),
    });
    assert.equal(unsafe.status, 400);
  } finally {
    await app.close();
  }
});

test("a publicly registered default-looking username never receives administrator capabilities", async () => {
  const app = await fixture();
  try {
    const account = await register(app.baseUrl, ALICE_CLIENT, "Waterfak3r");
    assert.deepEqual(account.user.capabilities, []);
    assert.equal(account.user.role, "user");
    const denied = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      headers: jsonHeaders(ALICE_CLIENT, account.cookie),
    });
    assert.equal(denied.status, 403);
  } finally {
    await app.close();
  }
});

test("production sessions are Secure and authenticated mutations require browser origin evidence", async () => {
  const store = new InMemoryStudyStore();
  const app = await fixture({ studyStore: store, productionSecurity: true });
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    assert.match(alice.setCookie, /;\s*Secure(?:;|$)/);
    const promoted = await store.setUserRole("Alice", "admin");
    assert.equal(promoted?.role, "admin");

    const noOrigin = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, alice.cookie),
      body: JSON.stringify({ donationImageUrl: null }),
    });
    assert.equal(noOrigin.status, 403);
    assert.equal((await noOrigin.json() as { error: { code: string } }).error.code, "CSRF_ORIGIN_DENIED");

    const sameOrigin = await fetch(`${app.baseUrl}/api/admin/site-settings`, {
      method: "PATCH",
      headers: {
        ...jsonHeaders(ALICE_CLIENT, alice.cookie),
        origin: app.baseUrl,
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ donationImageUrl: null }),
    });
    assert.equal(sameOrigin.status, 200);
  } finally {
    await app.close();
  }
});

test("reserved object property names are rejected as anonymous client ids", async () => {
  const app = await fixture();
  try {
    const response = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      headers: jsonHeaders("constructor"),
    });
    assert.equal(response.status, 400);
  } finally {
    await app.close();
  }
});

test("accounts can export their data and password-confirmed deletion removes private state", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    const accountHeaders = jsonHeaders(ALICE_CLIENT, alice.cookie);
    await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers: accountHeaders,
      body: JSON.stringify({ title: "Private export" }),
    });
    await fetch(`${app.baseUrl}/api/messages`, {
      method: "POST",
      headers: accountHeaders,
      body: JSON.stringify({ content: "Please export me", contact: "alice@example.test" }),
    });

    const exported = await fetch(`${app.baseUrl}/api/account/export`, { headers: accountHeaders });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-disposition") ?? "", /attachment/);
    const payload = await exported.json() as {
      study: { account: { username: string }; collection: { wordbooks: Array<{ title: string }> } };
      engagement: { messages: Array<{ content: string; contact: string }> };
    };
    assert.equal(payload.study.account.username, "Alice");
    assert.deepEqual(payload.study.collection.wordbooks.map((book) => book.title), ["Private export"]);
    assert.equal(payload.engagement.messages[0]?.contact, "alice@example.test");

    const wrongPassword = await fetch(`${app.baseUrl}/api/account`, {
      method: "DELETE",
      headers: accountHeaders,
      body: JSON.stringify({ password: "wrong-password" }),
    });
    assert.equal(wrongPassword.status, 403);

    const deleted = await fetch(`${app.baseUrl}/api/account`, {
      method: "DELETE",
      headers: accountHeaders,
      body: JSON.stringify({ password: "password-123" }),
    });
    assert.equal(deleted.status, 204);
    assert.match(deleted.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`, { headers: accountHeaders })).status, 401);
    assert.equal(await app.store.getUserByUsername("Alice"), null);
    assert.deepEqual(await app.store.listMyWordbooks(ALICE_CLIENT, false), []);

    const messages = await (await fetch(`${app.baseUrl}/api/messages`, {
      headers: jsonHeaders(BOB_CLIENT),
    })).json() as { items: Array<{ author: string; status: string; content?: string; contact?: string }> };
    assert.equal(messages.items[0]?.author, "已注销用户");
    assert.equal(messages.items[0]?.status, "deleted");
    assert.equal(messages.items[0]?.content, undefined);
    assert.equal(messages.items[0]?.contact, undefined);
  } finally {
    await app.close();
  }
});

test("password changes verify the current secret and revoke other sessions", async () => {
  const app = await fixture();
  try {
    const alice = await register(app.baseUrl, ALICE_CLIENT, "Alice");
    const secondLogin = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders("client-second-0001"),
      body: JSON.stringify({ username: "Alice", password: "password-123" }),
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0]!;

    const wrongCurrent = await fetch(`${app.baseUrl}/api/account/password`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, alice.cookie),
      body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-password-456" }),
    });
    assert.equal(wrongCurrent.status, 403);
    assert.equal((await wrongCurrent.json() as { error: { code: string } }).error.code, "INVALID_PASSWORD");

    const unchanged = await fetch(`${app.baseUrl}/api/account/password`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, alice.cookie),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "password-123" }),
    });
    assert.equal(unchanged.status, 409);

    const changed = await fetch(`${app.baseUrl}/api/account/password`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, alice.cookie),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "new-password-456" }),
    });
    assert.equal(changed.status, 204);
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie: alice.cookie } })).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie: secondCookie } })).status, 401);

    const oldLogin = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders("client-third-00001"),
      body: JSON.stringify({ username: "Alice", password: "password-123" }),
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders("client-third-00001"),
      body: JSON.stringify({ username: "Alice", password: "new-password-456" }),
    });
    assert.equal(newLogin.status, 200);
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

test("public registration can be disabled without affecting session login", async () => {
  const store = new InMemoryStudyStore();
  const passwordHash = await import("../src/auth.js").then(({ hashPassword }) => hashPassword("password-123"));
  const created = await store.createUser("Existing", passwordHash, ALICE_CLIENT);
  assert.equal(created.kind, "created");
  const app = await fixture({ studyStore: store, registrationEnabled: false });
  try {
    const denied = await fetch(`${app.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: jsonHeaders(BOB_CLIENT),
      body: JSON.stringify({ username: "NewUser", password: "password-123" }),
    });
    assert.equal(denied.status, 403);

    const login = await fetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: jsonHeaders(BOB_CLIENT),
      body: JSON.stringify({ username: "Existing", password: "password-123" }),
    });
    assert.equal(login.status, 200);
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
  const store = new InspectableStore({
    version: 3,
    catalog: [],
    revisions: [],
    contributions: [],
    clients: {},
    users: [],
    userAvatars: {},
    sessions: [],
  });
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

test("collaboration API supports preview, public audit, atomic merge, version history, and revert", async () => {
  const app = await fixture();
  try {
    const publisher = await register(app.baseUrl, ALICE_CLIENT, "Publisher");
    const contributor = await register(app.baseUrl, BOB_CLIENT, "Contributor");
    const sourceResponse = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({
        title: "Shared words",
        words: [
          { word: "alpha", phonetic: "/alpha/", meanings: [{ pos: "noun", definition: "alpha" }], source: "user", zhMeaning: "甲", zhMeaningSource: "user" },
          { word: "beta", phonetic: "/beta/", meanings: [{ pos: "noun", definition: "beta" }], source: "user", zhMeaning: "乙", zhMeaningSource: "user" },
        ],
      }),
    });
    assert.equal(sourceResponse.status, 201);
    const source = await sourceResponse.json() as { id: string };
    const uploadResponse = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ sourceWordbookId: source.id, visibility: "public", message: "首次发布" }),
    });
    assert.equal(uploadResponse.status, 201);
    const catalog = await uploadResponse.json() as { id: string; headRevisionId: string; collaborationEnabled: boolean };
    assert.equal(catalog.collaborationEnabled, true);
    assert.match(catalog.headRevisionId, /^revision-/);

    const joinedResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, {
      method: "POST",
      headers: jsonHeaders(BOB_CLIENT, contributor.cookie),
    });
    assert.equal(joinedResponse.status, 201);
    const joined = await joinedResponse.json() as { wordbook: { id: string; sourceRevisionId: string } };
    assert.equal(joined.wordbook.sourceRevisionId, catalog.headRevisionId);
    const wordsResponse = await fetch(`${app.baseUrl}/api/my/wordbooks/${joined.wordbook.id}/words`, {
      headers: jsonHeaders(BOB_CLIENT, contributor.cookie),
    });
    const words = await wordsResponse.json() as Array<{ id: string; word: string }>;
    const alpha = words.find((word) => word.word === "alpha")!;
    const updateResponse = await fetch(`${app.baseUrl}/api/my/wordbooks/${joined.wordbook.id}/words/${alpha.id}`, {
      method: "PATCH",
      headers: jsonHeaders(BOB_CLIENT, contributor.cookie),
      body: JSON.stringify({ zhMeaning: "改进后的甲" }),
    });
    assert.equal(updateResponse.status, 200);

    const previewResponse = await fetch(`${app.baseUrl}/api/my/wordbooks/${joined.wordbook.id}/contribution-preview`, {
      headers: jsonHeaders(BOB_CLIENT, contributor.cookie),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as {
      catalogId: string;
      expectedSourceUpdatedAt: string;
      expectedHeadRevisionId: string;
      changes: Array<{ kind: string; key: string }>;
    };
    assert.deepEqual(preview.changes.map((change) => [change.kind, change.key]), [["update", "alpha"]]);
    const createResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/contributions`, {
      method: "POST",
      headers: jsonHeaders(BOB_CLIENT, contributor.cookie),
      body: JSON.stringify({
        title: "完善 alpha 释义",
        description: "更准确的中文释义",
        expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
        expectedHeadRevisionId: preview.expectedHeadRevisionId,
      }),
    });
    assert.equal(createResponse.status, 201);
    const contribution = await createResponse.json() as Record<string, unknown> & { id: string; status: string };
    assert.equal("sourceWordbookId" in contribution, false);
    assert.equal("contributorUserId" in contribution, false);

    const blockedVisibility = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ visibility: "private" }),
    });
    assert.equal(blockedVisibility.status, 409);
    assert.deepEqual(await blockedVisibility.json(), {
      error: {
        code: "CATALOG_OPEN_CONTRIBUTIONS",
        message: "Resolve open contributions before changing visibility",
      },
      openContributionCount: 1,
    });

    const publicAudit = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/contributions/${contribution.id}`, {
      headers: jsonHeaders(ANON_CLIENT),
    });
    assert.equal(publicAudit.status, 200);
    const publicContribution = await publicAudit.json() as Record<string, unknown> & { status: string };
    assert.equal(publicContribution.status, "open");
    for (const privateField of ["sourceWordbookId", "contributorUserId", "handledByUserId"]) {
      assert.equal(privateField in publicContribution, false);
    }

    const mergeResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/contributions/${contribution.id}/merge`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ resolutionNote: "感谢完善" }),
    });
    assert.equal(mergeResponse.status, 200);
    assert.equal((await mergeResponse.json() as { status: string }).status, "merged");
    const mergedCatalog = await (await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
    })).json() as { words: Array<{ word: string; zhMeaning?: string }>; headRevisionId: string };
    assert.equal(mergedCatalog.words.find((word) => word.word === "alpha")?.zhMeaning, "改进后的甲");

    const missingSnapshotHead = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ sourceWordbookId: source.id }),
    });
    assert.equal(missingSnapshotHead.status, 409);
    assert.equal((await missingSnapshotHead.json() as { error: { code: string } }).error.code, "CATALOG_HEAD_REQUIRED");

    const staleSnapshot = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ sourceWordbookId: source.id, expectedHeadRevisionId: catalog.headRevisionId }),
    });
    assert.equal(staleSnapshot.status, 409);
    assert.equal((await staleSnapshot.json() as { error: { code: string } }).error.code, "CATALOG_HEAD_STALE");

    const alternateSourceResponse = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({
        title: "Alternate source",
        words: [{ word: "alpha", phonetic: "/alpha/", meanings: [{ pos: "noun", definition: "alpha" }], source: "user", zhMeaning: "另一个来源", zhMeaningSource: "user" }],
      }),
    });
    assert.equal(alternateSourceResponse.status, 201);
    const alternateSource = await alternateSourceResponse.json() as { id: string };
    const switchedSource = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ sourceWordbookId: alternateSource.id, expectedHeadRevisionId: mergedCatalog.headRevisionId }),
    });
    assert.equal(switchedSource.status, 409);
    assert.equal((await switchedSource.json() as { error: { code: string } }).error.code, "CATALOG_SOURCE_MISMATCH");

    const noOpSnapshot = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, {
      method: "PATCH",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ sourceWordbookId: source.id, expectedHeadRevisionId: mergedCatalog.headRevisionId }),
    });
    assert.equal(noOpSnapshot.status, 200);
    assert.equal((await noOpSnapshot.json() as { headRevisionId: string }).headRevisionId, mergedCatalog.headRevisionId);

    const revisionsResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/revisions`, {
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
    });
    assert.equal(revisionsResponse.status, 200);
    const revisions = await revisionsResponse.json() as { items: Array<Record<string, unknown> & { id: string; kind: string }> };
    for (const revision of revisions.items) {
      assert.equal("authorUserId" in revision, false);
      assert.equal("committerUserId" in revision, false);
    }
    assert.equal(revisions.items.some((revision) => revision.kind === "update"), false);
    const mergeRevision = revisions.items.find((revision) => revision.kind === "merge")!;
    const revertPreviewResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/revisions/${mergeRevision.id}/revert-preview`, {
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
    });
    assert.equal(revertPreviewResponse.status, 200);
    const revertPreview = await revertPreviewResponse.json() as { headRevisionId: string };
    const revertResponse = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/revisions/${mergeRevision.id}/revert`, {
      method: "POST",
      headers: jsonHeaders(ALICE_CLIENT, publisher.cookie),
      body: JSON.stringify({ expectedHeadRevisionId: revertPreview.headRevisionId }),
    });
    assert.equal(revertResponse.status, 201);
    assert.equal((await revertResponse.json() as { kind: string }).kind, "revert");
  } finally {
    await app.close();
  }
});
