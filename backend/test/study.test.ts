import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp, type CreateAppOptions } from "../src/app.js";
import { InMemoryStudyStore, JsonFileStudyStore } from "../src/study/store.js";
import type { WordEntry } from "../src/words/types.js";

const CLIENT = "client-12345678";
const OTHER_CLIENT = "client-87654321";
const headers = { "x-vocab-client-id": CLIENT, "content-type": "application/json" };

async function server(options: Omit<CreateAppOptions, "studyStore"> = {}) {
  const http: Server = createApp({ ...options, studyStore: new InMemoryStudyStore() }).listen(0);
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())),
  };
}

async function register(baseUrl: string, clientId = CLIENT, username = "tester") {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "x-vocab-client-id": clientId, "content-type": "application/json" },
    body: JSON.stringify({ username, password: "password-123" }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  return { "x-vocab-client-id": clientId, "content-type": "application/json", cookie };
}

test("new clients start with an empty collection and catalog; uploaded wordbooks remain usable", async () => {
  const app = await server();
  try {
    const denied = await fetch(`${app.baseUrl}/api/catalog/wordbooks`);
    assert.equal(denied.status, 400);

    const search = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=IELTS&sort=rating`, { headers });
    assert.equal(search.status, 200);
    const cards = await search.json() as Array<{ id: string; title: string; favorited: boolean; added: boolean; uploaded: boolean }>;
    assert.deepEqual(cards, []);

    const favorites = await fetch(`${app.baseUrl}/api/catalog/favorites`, { headers });
    assert.deepEqual(await favorites.json(), []);
    const allCatalog = await fetch(`${app.baseUrl}/api/catalog/wordbooks`, { headers });
    assert.deepEqual(await allCatalog.json(), []);
    const mineBeforeImport = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers });
    assert.deepEqual(await mineBeforeImport.json(), []);

    const accountHeaders = await register(app.baseUrl);
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST",
      headers: accountHeaders,
      body: JSON.stringify({
        title: "自定义雅思词库",
        exams: ["IELTS"],
        goals: ["写作"],
        words: [
          { word: "coherent", phonetic: "/kəʊˈhɪərənt/", source: "user", meanings: [{ pos: "adjective", definition: "Logical and consistent." }] },
          { word: "sustain", phonetic: "/səˈsteɪn/", source: "user", meanings: [{ pos: "verb", definition: "Keep something going." }] },
        ],
      }),
    });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json() as { id: string; title: string; uploaded: boolean };
    assert.equal(uploaded.title, "自定义雅思词库");
    assert.equal(uploaded.uploaded, true);
    const id = uploaded.id;

    const filteredCatalog = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=IELTS`, { headers: accountHeaders });
    assert.deepEqual((await filteredCatalog.json() as Array<{ id: string }>).map((card) => card.id), [id]);

    const favorite = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers: accountHeaders });
    assert.deepEqual(await favorite.json(), { favorited: true, favoriteCount: 1 });
    const favoriteAgain = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers: accountHeaders });
    assert.deepEqual(await favoriteAgain.json(), { favorited: false, favoriteCount: 0 });
    const added = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers: accountHeaders });
    assert.equal(added.status, 201);
    const first = await added.json() as { wordbook: { id: string; wordCount: number }; created: boolean };
    assert.equal(first.created, true);
    assert.equal(first.wordbook.wordCount, 2);
    const repeated = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers: accountHeaders });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json() as { created: boolean }).created, false);
    const detailAfterRepeat = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}`, { headers: accountHeaders });
    const detail = await detailAfterRepeat.json() as { uses: number; favoriteCount: number; words: unknown[] };
    assert.equal(detail.uses, 1);
    assert.equal(detail.favoriteCount, 0);
    assert.equal(detail.words.length, 2);
    const otherAdd = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, {
      method: "POST",
      headers: { "x-vocab-client-id": OTHER_CLIENT, "content-type": "application/json" },
    });
    assert.equal(otherAdd.status, 201);
    assert.equal((await (await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}`, { headers: accountHeaders })).json() as { uses: number }).uses, 2);

    const mine = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers: accountHeaders });
    assert.equal((await mine.json() as unknown[]).length, 1);
    const isolated = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers: { "x-vocab-client-id": OTHER_CLIENT } });
    assert.equal((await isolated.json() as unknown[]).length, 1);
  } finally { await app.close(); }
});

test("a new anonymous client can create a wordbook and starts with no learning activity", async () => {
  const app = await server();
  try {
    const books = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers });
    const list = await books.json() as Array<{ id: string; wordCount: number }>;
    assert.deepEqual(list, []);
    const emptyCreate = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "空词本" }),
    });
    const emptyBook = await emptyCreate.json() as { id: string };
    const emptyDashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${emptyBook.id}`, { headers });
    assert.deepEqual(
      (await emptyDashboard.json() as { todayPlan: unknown }).todayPlan,
      { new: { target: 0, completed: 0 }, review: { target: 0, completed: 0 }, dictation: { target: 0, completed: 0 } },
    );
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "新词本", words: [{ word: "resilient", phonetic: "/rɪˈzɪliənt/", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] }] }),
    });
    assert.equal(create.status, 201);
    const primary = await create.json() as { id: string; wordCount: number };
    assert.equal(primary.wordCount, 1);
    const untouchedDashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${primary.id}`, { headers });
    assert.equal(untouchedDashboard.status, 200);
    const pristine = await untouchedDashboard.json() as {
      recentActivity: unknown[];
      calendar: Array<{ active: boolean }>;
      todayPlan: { new: { target: number; completed: number }; review: { target: number; completed: number }; dictation: { target: number; completed: number } };
      week: { newCount: number; reviewCount: number; dictationCount: number; total: number };
      streakDays: number;
    };
    assert.deepEqual(pristine.recentActivity, []);
    assert.ok(pristine.calendar.every((date) => !date.active));
    // 听写训练 draws only from studied words (status !== "new"); a fresh single-word book has none yet.
    assert.deepEqual(pristine.todayPlan, { new: { target: 1, completed: 0 }, review: { target: 0, completed: 0 }, dictation: { target: 0, completed: 0 } });
    assert.deepEqual(pristine.week, { newCount: 0, reviewCount: 0, dictationCount: 0, total: 0 });
    assert.equal(pristine.streakDays, 0);
    const queue = await fetch(`${app.baseUrl}/api/my/wordbooks/${primary.id}/words`, { headers });
    const words = await queue.json() as Array<{ word: string }>;
    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: primary.id, word: words[0]!.word, verdict: "know" }) });
    assert.equal(event.status, 201);
    const dashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${primary.id}`, { headers });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json() as { todayPlan: { review: { completed: number } } }).todayPlan.review.completed, 0);
  } finally { await app.close(); }
});

test("resource limits reject growth while still allowing an over-limit client to delete data", async () => {
  const store = new InMemoryStudyStore({
    limits: { maxWordbooksPerClient: 1, maxWordsPerClient: 1, maxDraftsPerClient: 1 },
  });
  const first = await store.createMyWordbook(CLIENT, {
    title: "Allowed",
    words: [dictionaryEntry("alpha")],
  });
  await assert.rejects(
    () => store.createMyWordbook(CLIENT, { title: "Too many" }),
    { name: "StudyResourceLimitError" },
  );
  await assert.rejects(
    () => store.addWordToMyWordbook(CLIENT, first.id, dictionaryEntry("beta")),
    { name: "StudyResourceLimitError" },
  );
  assert.equal(await store.deleteMyWordbook(CLIENT, first.id), true);
  assert.equal(await store.purgeMyWordbook(CLIENT, first.id), true);
});

test("personal wordbook categories trim, clear, validate, and remain client-scoped", async () => {
  const app = await server();
  try {
    const createdResponse = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Academic", description: "Writing words", category: "  IELTS 写作  " }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { id: string; category?: string };
    assert.equal(created.category, "IELTS 写作");

    const changedResponse = await fetch(`${app.baseUrl}/api/my/wordbooks/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ category: "  核心词  " }),
    });
    assert.equal(changedResponse.status, 200);
    assert.equal((await changedResponse.json() as { category?: string }).category, "核心词");

    const denied = await fetch(`${app.baseUrl}/api/my/wordbooks/${created.id}`, {
      method: "PATCH",
      headers: { ...headers, "x-vocab-client-id": OTHER_CLIENT },
      body: JSON.stringify({ category: "越权" }),
    });
    assert.equal(denied.status, 404);

    const invalid = await fetch(`${app.baseUrl}/api/my/wordbooks/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ category: "x".repeat(31) }),
    });
    assert.equal(invalid.status, 400);

    const clearedResponse = await fetch(`${app.baseUrl}/api/my/wordbooks/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ category: null }),
    });
    assert.equal(clearedResponse.status, 200);
    assert.equal("category" in await clearedResponse.json(), false);
  } finally {
    await app.close();
  }
});

test("study routes reject malformed inputs and events outside the selected wordbook", async () => {
  const app = await server();
  try {
    const accountHeaders = await register(app.baseUrl);
    const invalidQuery = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=not-an-exam`, { headers: accountHeaders });
    assert.equal(invalidQuery.status, 400);
    const invalidUpload = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ title: "" }) });
    assert.equal(invalidUpload.status, 400);
    const invalidEvent = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ kind: "flashcard", wordbookId: "my-not-real", word: "test" }) });
    assert.equal(invalidEvent.status, 400);
    const unknownWord = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ kind: "new", wordbookId: "my-not-real", word: "test" }) });
    assert.equal(unknownWord.status, 404);
  } finally { await app.close(); }
});

test("study events drive queues and the selected-wordbook dashboard", async () => {
  const app = await server();
  try {
    const accountHeaders = await register(app.baseUrl);
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST",
      headers: accountHeaders,
      body: JSON.stringify({
        title: "练习词库",
        visibility: "unlisted",
        words: [
          { word: "resilient", phonetic: "/rɪˈzɪliənt/", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] },
          { word: "empirical", phonetic: "/ɪmˈpɪrɪkəl/", source: "user", meanings: [{ pos: "adjective", definition: "Based on observation." }] },
        ],
      }),
    });
    assert.equal(upload.status, 201);
    const catalog = await upload.json() as { id: string };
    const created = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers: accountHeaders });
    assert.equal(created.status, 201);
    const book = (await created.json() as { wordbook: { id: string } }).wordbook;
    const words = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words?status=new`, { headers: accountHeaders });
    const queue = await words.json() as Array<{ word: string; status: string }>;
    assert.equal(queue.length, 2);

    const flashcard = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, word: queue[0]!.word, verdict: "know" }) });
    assert.equal(flashcard.status, 201);
    const dictation = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ kind: "dictation", wordbookId: book.id, word: queue[1]!.word, correct: false }) });
    assert.equal(dictation.status, 201);
    const dashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers: accountHeaders });
    const data = await dashboard.json() as { wordbook: { progress: { mastered: number; learning: number; levels: { l1: number } } }; todayPlan: { review: { completed: number }; dictation: { completed: number } }; recentActivity: unknown[]; calendar: unknown[] };
    // A single flashcard "know" reaches 初识 (L1); a failed dictation floors the other word at L1 too.
    assert.equal(data.wordbook.progress.learning, 2);
    assert.equal(data.wordbook.progress.levels.l1, 2);
    assert.equal(data.wordbook.progress.mastered, 0);
    assert.equal(data.todayPlan.review.completed, 0);
    assert.equal(data.todayPlan.dictation.completed, 0);
    assert.equal(data.recentActivity.length, 2);
    assert.equal(data.calendar.length, 7);
  } finally { await app.close(); }
});

test("upload, share-code import, recycle bin, and restore form a usable collection loop", async () => {
  const app = await server();
  try {
    const accountHeaders = await register(app.baseUrl);
    const importerHeaders = { "x-vocab-client-id": OTHER_CLIENT, "content-type": "application/json" };
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ title: "我的学术词库", description: "自定义", exams: ["IELTS"], goals: ["写作"], visibility: "unlisted", words: [{ word: "coherent", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Logical and consistent." }] }] }) });
    assert.equal(upload.status, 201);
    const catalog = await upload.json() as { shareCode: string; id: string; uploaded: boolean };
    assert.equal(catalog.uploaded, true);
    const imported = await fetch(`${app.baseUrl}/api/catalog/imports`, { method: "POST", headers: importerHeaders, body: JSON.stringify({ shareCode: catalog.shareCode }) });
    assert.equal(imported.status, 201);
    const wordbook = (await imported.json() as { wordbook: { id: string } }).wordbook;
    const deleted = await fetch(`${app.baseUrl}/api/my/wordbooks/${wordbook.id}`, { method: "DELETE", headers: importerHeaders });
    assert.equal(deleted.status, 204);
    const trash = await fetch(`${app.baseUrl}/api/my/wordbooks?view=trash`, { headers: importerHeaders });
    assert.equal((await trash.json() as unknown[]).length, 1);
    const restored = await fetch(`${app.baseUrl}/api/my/wordbooks/${wordbook.id}/restore`, { method: "POST", headers: importerHeaders });
    assert.equal(restored.status, 200);
  } finally { await app.close(); }
});

test("JSON store persists mutations with a complete atomic document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-study-"));
  const file = join(directory, "state.json");
  try {
    const first = new JsonFileStudyStore(file);
    const created = await first.createMyWordbook(CLIENT, { title: "Local", words: [] });
    await Promise.all([first.createMyWordbook(CLIENT, { title: "A" }), first.createMyWordbook(CLIENT, { title: "B" })]);
    assert.ok(created.id);
    const raw = await readFile(file, "utf8");
    assert.match(raw, /"version": 5/);
    const reloaded = new JsonFileStudyStore(file);
    assert.equal((await reloaded.listMyWordbooks(CLIENT, false)).length, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("JSON store preserves a deliberately empty persisted state without restoring demo data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-study-empty-"));
  const file = join(directory, "state.json");
  try {
    await writeFile(file, `${JSON.stringify({ version: 2, catalog: [], clients: {} })}\n`, "utf8");
    const store = new JsonFileStudyStore(file);
    assert.deepEqual(await store.listCatalog(CLIENT, {}), []);
    assert.deepEqual(await store.listMyWordbooks(CLIENT, false), []);
    // Read-only requests neither rewrite the file nor mint client records.
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2, catalog: [], clients: {} });
    await store.createMyWordbook(CLIENT, { title: "First", words: [] });
    const persisted = JSON.parse(await readFile(file, "utf8")) as { version: number; catalog: unknown[]; clients: Record<string, { wordbooks: unknown[] }> };
    assert.equal(persisted.version, 5);
    assert.deepEqual(persisted.catalog, []);
    assert.equal(persisted.clients[CLIENT]?.wordbooks.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("stored curly-apostrophe words fold on load so matching keeps working", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-study-fold-"));
  const file = join(directory, "state.json");
  try {
    const at = "2026-01-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify({
      version: 3,
      catalog: [],
      clients: { [CLIENT]: { favorites: [], wordbooks: [{ id: "my-legacy", title: "Legacy", description: "", createdAt: at, updatedAt: at, words: [{ word: "don’t", phonetic: "", meanings: [], source: "user" }] }], events: [], drafts: [] } },
    }), "utf8");
    const store = new JsonFileStudyStore(file);
    const words = await store.listWords(CLIENT, "my-legacy");
    assert.equal(words?.[0]?.word, "don't");
    const event = await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: "my-legacy", word: "don't", correct: true });
    assert.ok(event, "folded stored word must be matchable by today's normalized form");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function dictionaryEntry(word: string): WordEntry {
  return {
    word,
    phonetic: `/${word}/`,
    audioUrl: `https://audio.example/${word}.mp3`,
    meanings: [{ pos: "noun", definition: `English definition for ${word}.` }],
    source: "backend",
  };
}
function alphabeticWord(index: number): string {
  let value = index; let suffix = "";
  do { suffix = String.fromCharCode(97 + (value % 26)) + suffix; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return `word${suffix}`;
}
async function eventually<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read(); if (matches(value)) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for asynchronous import processing");
}

test("import drafts preserve Chinese input, enforce the 500-line boundary, and append later drafts", async () => {
  const app = await server({
    wordLookup: { async lookup(word) { return word === "missing" ? null : dictionaryEntry(word); } },
    localChineseLookup: { async lookup(word) { return word === "fallback" ? "本地中文释义" : undefined; } },
  });
  try {
    const words = Array.from({ length: 498 }, (_, index) => alphabeticWord(index));
    const response = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST", headers,
      body: JSON.stringify({ title: "分批导入", lines: [{ line: 1, word: "resilient", pos: "adjective", enDefinition: "Able to recover, even under pressure.", zhMeaning: "坚韧的", example: "A resilient team recovered.", }, { line: 2, word: "fallback" }, ...words.map((word, index) => ({ line: index + 3, word }))] }),
    });
    assert.equal(response.status, 201);
    const first = await response.json() as { id: string; entries: unknown[]; batchIndex: number; totalBatches: number };
    assert.equal(first.batchIndex, 1);
    assert.equal(first.totalBatches, 1);
    assert.equal(first.entries.length, 500);
    const drafts = await (await fetch(`${app.baseUrl}/api/my/import-drafts`, { headers })).json() as Array<{
      id: string; batchIndex: number; targetWordbookId?: string;
      entries: Array<{ word: string; entry: { zhMeaning?: string; zhMeaningSource?: string; source: string; meanings: Array<{ pos: string; definition: string; example?: string }> } }>;
    }>;
    assert.equal(drafts.length, 1);
    const custom = drafts.flatMap((draft) => draft.entries).find((entry) => entry.word === "resilient")!;
    assert.deepEqual(custom.entry.zhMeaning, "坚韧的");
    assert.equal(custom.entry.zhMeaningSource, "user");
    assert.equal(custom.entry.source, "user");
    assert.deepEqual(custom.entry.meanings, [{ pos: "adjective", definition: "Able to recover, even under pressure.", example: "A resilient team recovered." }]);
    const fallback = drafts.flatMap((draft) => draft.entries).find((entry) => entry.word === "fallback")!;
    assert.equal(fallback.entry.zhMeaning, "本地中文释义");
    assert.equal(fallback.entry.zhMeaningSource, "dictionary");
    const firstCommit = await fetch(`${app.baseUrl}/api/my/import-drafts/${first.id}/commit`, { method: "POST", headers, body: "{}" });
    assert.equal(firstCommit.status, 200);
    const firstBook = await firstCommit.json() as { id: string; wordCount: number };
    assert.equal(firstBook.wordCount, 500);

    const oversized = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST", headers,
      body: JSON.stringify({
        title: "超限",
        lines: Array.from({ length: 501 }, (_, index) => ({ line: index + 1, word: alphabeticWord(index) })),
      }),
    });
    assert.equal(oversized.status, 400);

    const appended = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST", headers,
      body: JSON.stringify({
        title: "追加导入",
        targetWordbookId: firstBook.id,
        lines: ["extraalpha", "extrabeta", "extragamma"].map((word, index) => ({ line: index + 1, word })),
      }),
    });
    assert.equal(appended.status, 201);
    const next = await appended.json() as { id: string };
    await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts/${next.id}`, { headers })).json() as { status: string; entries: Array<{ status: string }> },
      (draft) => draft.status === "pending" && draft.entries.every((entry) => entry.status !== "processing"),
    );
    const secondCommit = await fetch(`${app.baseUrl}/api/my/import-drafts/${next.id}/commit`, { method: "POST", headers, body: "{}" });
    const complete = await secondCommit.json() as { id: string; wordCount: number };
    assert.equal(complete.id, firstBook.id);
    assert.equal(complete.wordCount, 503);
    const linked = await (await fetch(`${app.baseUrl}/api/my/import-drafts/${next.id}`, { headers })).json() as { targetWordbookId: string };
    assert.equal(linked.targetWordbookId, firstBook.id);
  } finally { await app.close(); }
});

test("word is the only required import field and supplied parts of speech target matching meanings", async () => {
  const lookedUp: string[] = [];
  const app = await server({
    wordLookup: {
      async lookup(word) {
        lookedUp.push(word);
        if (word === "initial public offering") {
          return {
            word,
            phonetic: "",
            meanings: [{ pos: "noun", definition: "The first public sale of company shares." }],
            source: "backend",
          };
        }
        if (word === "research and development") {
          return {
            word,
            phonetic: "",
            meanings: [{ pos: "noun", definition: "Work directed toward innovation." }],
            source: "backend",
          };
        }
        if (word !== "matched") return null;
        return {
          word,
          phonetic: "",
          meanings: [
            { pos: "noun", definition: "A corresponding item." },
            { pos: "verb", definition: "To correspond." },
          ],
          source: "backend",
        };
      },
    },
  });
  try {
    const response = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "可选字段导入",
        lines: [
          { line: 1, word: "matched", pos: "v.", example: "The results matched." },
          { line: 2, word: "orphan-pos", pos: "adjective" },
          { line: 3, word: "orphan-example", example: "An example without a definition." },
          { line: 4, word: "bare" },
          { line: 5, word: "chinese-only", zhMeaning: "仅中文释义" },
          { line: 6, word: "initial public offering(IPO)", pos: "n.", zhMeaning: "首次公开募股" },
          { line: 7, word: "research and development(R&D)", pos: "abbr.", zhMeaning: "研究与开发" },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as { id: string };
    const draft = await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts/${created.id}`, { headers })).json() as {
        id: string;
        status: string;
        entries: Array<{
          word: string;
          status: string;
          entry: { meanings: Array<{ pos: string; definition: string; example?: string }>; zhMeaning?: string };
        }>;
      },
      (value) => value.status === "pending",
    );

    assert.deepEqual(draft.entries.map((entry) => entry.status), ["ready", "unmatched", "unmatched", "unmatched", "unmatched", "ready", "ready"]);
    const matched = draft.entries[0]!.entry.meanings;
    assert.deepEqual(matched, [
      { pos: "noun", definition: "A corresponding item." },
      { pos: "v.", definition: "To correspond.", example: "The results matched." },
    ]);
    assert.deepEqual(draft.entries[1]!.entry.meanings, [{ pos: "adjective", definition: "" }]);
    assert.deepEqual(draft.entries[2]!.entry.meanings, [{ pos: "unknown", definition: "", example: "An example without a definition." }]);
    assert.deepEqual(draft.entries[3]!.entry.meanings, []);
    assert.equal(draft.entries[4]!.entry.zhMeaning, "仅中文释义");
    assert.equal(draft.entries[5]!.word, "initial public offering (ipo)");
    assert.equal(draft.entries[5]!.entry.meanings[0]!.definition, "The first public sale of company shares.");
    assert.ok(lookedUp.includes("initial public offering"));
    assert.equal(lookedUp.includes("initial public offering (ipo)"), false);
    assert.equal(draft.entries[6]!.word, "research and development (r&d)");
    assert.ok(lookedUp.includes("research and development"));
    assert.equal(lookedUp.includes("research and development (r&d)"), false);

    const committed = await fetch(`${app.baseUrl}/api/my/import-drafts/${draft.id}/commit`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(committed.status, 200);
    assert.equal((await committed.json() as { wordCount: number }).wordCount, 7);
  } finally { await app.close(); }
});

test("phrase lookup falls back to the current client's most recently updated private wordbook", async () => {
  const app = await server({ wordLookup: { async lookup() { return null; } } });
  try {
    const create = async (title: string, definition: string) => {
      const response = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
        method: "POST", headers,
        body: JSON.stringify({ title, words: [{ word: "a lot of", phonetic: "", source: "user", meanings: [{ pos: "phrase", definition }] }] }),
      });
      return await response.json() as { id: string };
    };
    await create("较早词本", "older definition");
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    await create("最近词本", "newer definition");
    const own = await fetch(`${app.baseUrl}/api/words/a%20lot%20of`, { headers });
    assert.equal(own.status, 200);
    assert.equal((await own.json() as { meanings: Array<{ definition: string }> }).meanings[0]!.definition, "newer definition");
    assert.equal(own.headers.get("cache-control"), "private, no-store");
    const other = await fetch(`${app.baseUrl}/api/words/a%20lot%20of`, { headers: { ...headers, "x-vocab-client-id": OTHER_CLIENT } });
    assert.equal(other.status, 404);
  } finally { await app.close(); }
});

test("overwrite commits an entire import group atomically while retaining matching word progress", async () => {
  const app = await server({ wordLookup: { async lookup(word) { return dictionaryEntry(word); } } });
  try {
    const created = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST", headers,
      body: JSON.stringify({ title: "待覆盖", words: [dictionaryEntry("alpha"), dictionaryEntry("beta")] }),
    });
    const book = await created.json() as { id: string };
    const before = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; word: string }>;
    const alpha = before.find((word) => word.word === "alpha")!;
    const beta = before.find((word) => word.word === "beta")!;
    await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, wordId: alpha.id, verdict: "know" }) });
    await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, wordId: beta.id, verdict: "know" }) });

    const extra = Array.from({ length: 499 }, (_, index) => alphabeticWord(index));
    const createdDraft = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST", headers,
      body: JSON.stringify({
        title: "待覆盖", targetWordbookId: book.id,
        lines: [{ line: 1, word: "alpha", enDefinition: "Custom alpha." }, ...extra.map((word, index) => ({ line: index + 2, word }))],
      }),
    });
    const first = await createdDraft.json() as { id: string; groupId: string };
    await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts`, { headers })).json() as Array<{ groupId: string; status: string }>,
      (drafts) => drafts.filter((draft) => draft.groupId === first.groupId).every((draft) => draft.status === "pending"),
    );
    const committed = await fetch(`${app.baseUrl}/api/my/import-drafts/${first.id}/commit`, {
      method: "POST", headers, body: JSON.stringify({ mode: "overwrite" }),
    });
    assert.equal(committed.status, 200);
    assert.equal((await committed.json() as { wordCount: number }).wordCount, 500);
    const after = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; word: string; level: number; meanings: Array<{ definition: string }> }>;
    assert.equal(after.find((word) => word.word === "alpha")!.id, alpha.id);
    assert.equal(after.find((word) => word.word === "alpha")!.level, 1);
    assert.equal(after.find((word) => word.word === "alpha")!.meanings[0]!.definition, "Custom alpha.");
    assert.equal(after.some((word) => word.word === "beta"), false);
    const dashboard = await (await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers })).json() as { recentActivity: Array<{ wordId: string }> };
    assert.equal(dashboard.recentActivity.some((event) => event.wordId === beta.id), false);
  } finally { await app.close(); }
});

test("import processing returns immediately, rejects early commit, and can resume after a lookup failure", async () => {
  let releaseLookup: (() => void) | undefined;
  let available = false;
  const app = await server({
    wordLookup: {
      async lookup(word) {
        if (word === "delayed") return await new Promise<WordEntry>((resolve) => { releaseLookup = () => resolve(dictionaryEntry(word)); });
        if (!available) throw new Error("temporary dictionary outage");
        return dictionaryEntry(word);
      },
    },
  });
  try {
    const delayedResponse = await fetch(`${app.baseUrl}/api/my/import-drafts`, { method: "POST", headers, body: JSON.stringify({ title: "异步匹配", lines: [{ line: 1, word: "delayed" }] }) });
    assert.equal(delayedResponse.status, 201);
    const delayed = await delayedResponse.json() as { id: string; status: string; entries: Array<{ status: string }> };
    assert.equal(delayed.status, "processing");
    assert.equal(delayed.entries[0]!.status, "processing");
    const earlyCommit = await fetch(`${app.baseUrl}/api/my/import-drafts/${delayed.id}/commit`, { method: "POST", headers, body: "{}" });
    assert.equal(earlyCommit.status, 409);
    assert.ok(releaseLookup);
    releaseLookup!();
    const completed = await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts/${delayed.id}`, { headers })).json() as { status: string; entries: Array<{ status: string }> },
      (draft) => draft.status === "pending" && draft.entries[0]?.status === "ready",
    );
    assert.equal(completed.status, "pending");

    const recoverResponse = await fetch(`${app.baseUrl}/api/my/import-drafts`, { method: "POST", headers, body: JSON.stringify({ title: "可恢复匹配", lines: [{ line: 1, word: "recoverable" }] }) });
    const recover = await recoverResponse.json() as { id: string };
    await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts/${recover.id}`, { headers })).json() as { status: string; entries: Array<{ status: string; reason?: string }> },
      (draft) => draft.status === "processing" && draft.entries[0]?.status === "processing" && Boolean(draft.entries[0]?.reason),
    );
    available = true;
    const resumed = await fetch(`${app.baseUrl}/api/my/import-drafts/${recover.id}/process`, { method: "POST", headers, body: "{}" });
    assert.equal(resumed.status, 202);
    const recovered = await eventually(
      async () => await (await fetch(`${app.baseUrl}/api/my/import-drafts/${recover.id}`, { headers })).json() as { status: string; entries: Array<{ status: string }> },
      (draft) => draft.status === "pending" && draft.entries[0]?.status === "ready",
    );
    assert.equal(recovered.status, "pending");
  } finally { await app.close(); }
});

test("draft conflicts, word edits, and catalog publishing keep stable learner data and snapshots", async () => {
  const lookedUp: string[] = [];
  const app = await server({ wordLookup: { async lookup(word) { lookedUp.push(word); return dictionaryEntry(word); } } });
  try {
    const accountHeaders = await register(app.baseUrl);
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ title: "私有词本", words: [dictionaryEntry("resilient")] }) });
    const privateBook = await create.json() as { id: string };
    const conflict = await fetch(`${app.baseUrl}/api/my/import-drafts`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ title: "不会新建", targetWordbookId: privateBook.id, lines: [{ line: 1, word: "resilient", zhMeaning: "有韧性" }] }) });
    const draft = await conflict.json() as { id: string; entries: Array<{ id: string; status: string }> };
    assert.equal(draft.entries[0]!.status, "conflict");
    const merged = await fetch(`${app.baseUrl}/api/my/import-drafts/${draft.id}/commit`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ resolutions: { [draft.entries[0]!.id]: "merge" } }) });
    assert.equal(merged.status, 200);
    let words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words`, { headers: accountHeaders })).json() as Array<{ id: string; word: string; zhMeaning?: string; status: string }>;
    const initial = words[0]!;
    assert.equal(initial.zhMeaning, "有韧性");
    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ kind: "flashcard", wordbookId: privateBook.id, wordId: initial.id, verdict: "know" }) });
    assert.equal(event.status, 201);
    const renamed = await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words/${initial.id}`, { method: "PATCH", headers: accountHeaders, body: JSON.stringify({ word: "durable" }) });
    assert.equal(renamed.status, 200);
    assert.deepEqual((await renamed.json() as { id: string; word: string }).id, initial.id);
    // One flashcard "know" leaves the word at 初识 (L1 -> legacy status "learning"); the rename keeps its id and replayed level.
    const learningWords = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words?status=learning`, { headers: accountHeaders })).json() as Array<{ word: string; level: number }>;
    assert.deepEqual(learningWords.map((word) => word.word), ["durable"]);
    assert.equal(learningWords[0]!.level, 1);
    assert.ok(lookedUp.includes("durable"));

    const published = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ sourceWordbookId: privateBook.id, title: "社区快照" }) });
    const catalog = await published.json() as { id: string };
    assert.equal(published.status, 201);
    const changed = await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words/${initial.id}`, { method: "PATCH", headers: accountHeaders, body: JSON.stringify({ zhMeaning: "之后的私有修改" }) });
    assert.equal(changed.status, 200);
    const otherHeaders = { ...headers, "x-vocab-client-id": OTHER_CLIENT };
    const oldCopy = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers: otherHeaders });
    const oldBook = (await oldCopy.json() as { wordbook: { id: string } }).wordbook;
    const oldWords = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${oldBook.id}/words`, { headers: otherHeaders })).json() as Array<{ zhMeaning?: string }>;
    assert.equal(oldWords[0]!.zhMeaning, "有韧性");
    const refreshed = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { method: "PATCH", headers: accountHeaders, body: JSON.stringify({ sourceWordbookId: privateBook.id }) });
    assert.equal(refreshed.status, 200);
    const thirdHeaders = { ...headers, "x-vocab-client-id": "client-00000000" };
    const freshCopy = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers: thirdHeaders });
    const freshBook = (await freshCopy.json() as { wordbook: { id: string } }).wordbook;
    const freshWords = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${freshBook.id}/words`, { headers: thirdHeaders })).json() as Array<{ zhMeaning?: string }>;
    assert.equal(freshWords[0]!.zhMeaning, "之后的私有修改");
    assert.equal(oldWords[0]!.zhMeaning, "有韧性");
  } finally { await app.close(); }
});

test("v2 state migrates word IDs and old learning events without dropping progress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-study-v2-")); const file = join(directory, "state.json");
  try {
    await writeFile(file, JSON.stringify({ version: 2, catalog: [], clients: { [CLIENT]: { favorites: [], wordbooks: [{ id: "my-legacy", title: "Legacy", description: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", words: [{ word: "resilient", phonetic: "", meanings: [], source: "user" }] }], events: [{ id: "event-1", kind: "flashcard", wordbookId: "my-legacy", word: "resilient", verdict: "know", occurredAt: "2026-01-01T00:00:00.000Z" }] } } }), "utf8");
    const store = new JsonFileStudyStore(file);
    const words = await store.listWords(CLIENT, "my-legacy");
    assert.ok(words?.[0]?.id);
    // The old flashcard "know" replays cleanly to 初识 (L1 -> legacy status "learning").
    assert.equal(words?.[0]?.status, "learning");
    assert.equal(words?.[0]?.level, 1);
    // Reads keep the migrated state in memory only; the first mutation persists it.
    await store.createMyWordbook(CLIENT, { title: "Trigger", words: [] });
    const persisted = JSON.parse(await readFile(file, "utf8")) as { version: number; clients: Record<string, { wordbooks: Array<{ words: Array<{ id?: string }> }>; events: Array<{ wordId?: string }> }> };
    assert.equal(persisted.version, 5);
    assert.ok(persisted.clients[CLIENT]!.wordbooks[0]!.words[0]!.id);
    assert.equal(persisted.clients[CLIENT]!.events[0]!.wordId, persisted.clients[CLIENT]!.wordbooks[0]!.words[0]!.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("adding a word resolves dictionary data, dedupes, and never blocks on a failed lookup", async () => {
  const app = await server({
    wordLookup: {
      async lookup(word) {
        if (word === "offline") throw new Error("temporary dictionary outage");
        if (word === "missingword") return null;
        return dictionaryEntry(word);
      },
    },
  });
  try {
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers, body: JSON.stringify({ title: "加词词本" }) });
    const book = await create.json() as { id: string };

    // A matched lookup supplies English data; the learner's own zhMeaning wins.
    const added = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { method: "POST", headers, body: JSON.stringify({ word: "Resilient", zhMeaning: "有韧性" }) });
    assert.equal(added.status, 201);
    const addedWord = (await added.json() as { word: { id: string; word: string; phonetic: string; status: string; zhMeaning?: string; zhMeaningSource?: string; meanings: unknown[] } }).word;
    assert.equal(addedWord.word, "resilient");
    assert.equal(addedWord.status, "new");
    assert.equal(addedWord.phonetic, "/resilient/");
    assert.equal(addedWord.zhMeaning, "有韧性");
    assert.equal(addedWord.zhMeaningSource, "user");
    assert.ok(addedWord.meanings.length > 0);

    // A normalized duplicate returns the existing item with a 200, not a second copy.
    const duplicate = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { method: "POST", headers, body: JSON.stringify({ word: "RESILIENT" }) });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json() as { word: { id: string } }).word.id, addedWord.id);

    // A transient lookup failure still stores the word with empty dictionary fields.
    const offline = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { method: "POST", headers, body: JSON.stringify({ word: "offline" }) });
    assert.equal(offline.status, 201);
    const offlineWord = (await offline.json() as { word: { word: string; phonetic: string; meanings: unknown[]; status: string } }).word;
    assert.equal(offlineWord.word, "offline");
    assert.equal(offlineWord.phonetic, "");
    assert.deepEqual(offlineWord.meanings, []);
    assert.equal(offlineWord.status, "new");

    // A missing wordbook is a 404; an invalid word is a 400.
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/my-nope/words`, { method: "POST", headers, body: JSON.stringify({ word: "resilient" }) })).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { method: "POST", headers, body: JSON.stringify({ word: "123" }) })).status, 400);

    const words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as unknown[];
    assert.equal(words.length, 2);
  } finally { await app.close(); }
});

test("batch word actions refresh independently, preserve custom Chinese, mark mastered, and delete history", async () => {
  const app = await server({
    wordLookup: {
      async lookup(word) {
        if (word === "offline") throw new Error("temporary dictionary outage");
        return dictionaryEntry(word);
      },
    },
  });
  try {
    const created = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST", headers,
      body: JSON.stringify({ title: "批量管理", words: [
        { word: "alpha", phonetic: "", source: "user", zhMeaning: "自定义中文", zhMeaningSource: "user", meanings: [] },
        { word: "offline", phonetic: "", source: "user", meanings: [] },
      ] }),
    });
    const book = await created.json() as { id: string };
    const initial = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; word: string }>;
    const alpha = initial.find((word) => word.word === "alpha")!;
    const offline = initial.find((word) => word.word === "offline")!;

    const refresh = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words/batch`, {
      method: "POST", headers,
      body: JSON.stringify({ action: "refresh-meanings", wordIds: [alpha.id, offline.id] }),
    });
    assert.equal(refresh.status, 200);
    const refreshResult = await refresh.json() as { succeededIds: string[]; failed: Array<{ wordId: string; code: string }> };
    assert.deepEqual(refreshResult.succeededIds, [alpha.id]);
    assert.deepEqual(refreshResult.failed, [{ wordId: offline.id, code: "DICTIONARY_UNAVAILABLE" }]);
    const refreshed = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; phonetic: string; zhMeaning?: string; meanings: unknown[] }>;
    assert.equal(refreshed.find((word) => word.id === alpha.id)!.phonetic, "/alpha/");
    assert.equal(refreshed.find((word) => word.id === alpha.id)!.zhMeaning, "自定义中文");
    assert.ok(refreshed.find((word) => word.id === alpha.id)!.meanings.length > 0);
    assert.equal(refreshed.find((word) => word.id === offline.id)!.phonetic, "");

    const mark = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words/batch`, {
      method: "POST", headers,
      body: JSON.stringify({ action: "mark-mastered", wordIds: [alpha.id, offline.id] }),
    });
    assert.equal(mark.status, 200);
    const mastered = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; level: number }>;
    assert.ok(mastered.every((word) => word.level === 4));

    const remove = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words/batch`, {
      method: "POST", headers,
      body: JSON.stringify({ action: "delete", wordIds: [alpha.id] }),
    });
    assert.equal(remove.status, 200);
    const remaining = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string }>;
    assert.deepEqual(remaining.map((word) => word.id), [offline.id]);
    const dashboard = await (await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers })).json() as { recentActivity: Array<{ wordId: string }> };
    assert.ok(dashboard.recentActivity.every((event) => event.wordId !== alpha.id));
  } finally { await app.close(); }
});

test("purging removes only a trashed wordbook and drops its study events", async () => {
  const app = await server();
  try {
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers, body: JSON.stringify({ title: "待清空", words: [{ word: "resilient", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] }] }) });
    const book = await create.json() as { id: string };
    const words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string }>;
    await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, wordId: words[0]!.id, verdict: "know" }) });

    // An active (non-trashed) wordbook cannot be purged.
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/purge`, { method: "DELETE", headers })).status, 404);

    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}`, { method: "DELETE", headers })).status, 204);
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/purge`, { method: "DELETE", headers })).status, 204);

    assert.deepEqual(await (await fetch(`${app.baseUrl}/api/my/wordbooks?view=trash`, { headers })).json(), []);
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}`, { headers })).status, 404);
    // The book's events were dropped, so recording against it now 404s, as does a second purge.
    assert.equal((await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, word: "resilient", verdict: "know" }) })).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/purge`, { method: "DELETE", headers })).status, 404);
  } finally { await app.close(); }
});

test("purgeMyWordbook removes the book and its events at the store level", async () => {
  const store = new InMemoryStudyStore();
  const book = await store.createMyWordbook(CLIENT, { title: "T", words: [{ word: "resilient", phonetic: "", meanings: [], source: "user" }] });
  const words = await store.listWords(CLIENT, book.id);
  const wordId = words![0]!.id;
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId, verdict: "know" });
  // A live wordbook is never purged; only a trashed one is.
  assert.equal(await store.purgeMyWordbook(CLIENT, book.id), false);
  await store.deleteMyWordbook(CLIENT, book.id);
  assert.equal(await store.purgeMyWordbook(CLIENT, book.id), true);
  assert.deepEqual(await store.listMyWordbooks(CLIENT, true), []);
  // The word's event was removed alongside the book, so it can no longer be matched.
  assert.equal(await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId, verdict: "know" }), null);
});

test("deleting a catalog upload is owner-only and clears every client's favorite of it", async () => {
  const app = await server();
  try {
    const accountHeaders = await register(app.baseUrl);
    const otherHeaders = { ...headers, "x-vocab-client-id": OTHER_CLIENT };
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers: accountHeaders, body: JSON.stringify({ title: "可删上传", exams: ["IELTS"], goals: ["写作"], words: [{ word: "coherent", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Logical and consistent." }] }] }) });
    const catalog = await upload.json() as { id: string };
    // Another client favorites the listing and makes an independent copy of it.
    await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/favorite`, { method: "POST", headers: otherHeaders });
    const copy = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers: otherHeaders });
    const copiedBook = (await copy.json() as { wordbook: { id: string } }).wordbook;
    assert.equal((await (await fetch(`${app.baseUrl}/api/catalog/favorites`, { headers: otherHeaders })).json() as unknown[]).length, 1);

    // A non-owner cannot delete it, and the 404 does not leak that it exists.
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { method: "DELETE", headers: otherHeaders })).status, 404);

    // The owner deletes it: gone from the catalog and from the other client's favorites.
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { method: "DELETE", headers: accountHeaders })).status, 204);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { headers: accountHeaders })).status, 404);
    assert.deepEqual(await (await fetch(`${app.baseUrl}/api/catalog/favorites`, { headers: otherHeaders })).json(), []);
    // The independent copy the other client added survives; a second delete is a 404.
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${copiedBook.id}`, { headers: otherHeaders })).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { method: "DELETE", headers: accountHeaders })).status, 404);
  } finally { await app.close(); }
});

test("a new-session verdict round-trips into stored events and dashboard recent activity", async () => {
  const app = await server();
  try {
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers, body: JSON.stringify({ title: "新学词本", words: [{ word: "resilient", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] }] }) });
    const book = await create.json() as { id: string };
    const words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string }>;
    const wordId = words[0]!.id;

    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "new", wordbookId: book.id, wordId, verdict: "unknown" }) });
    assert.equal(event.status, 201);
    assert.equal((await event.json() as { kind: string; verdict?: string }).verdict, "unknown");
    // An out-of-range verdict is rejected; a verdict-less "new" event stays valid.
    assert.equal((await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "new", wordbookId: book.id, wordId, verdict: "maybe" }) })).status, 400);
    assert.equal((await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "new", wordbookId: book.id, wordId }) })).status, 201);

    const dashboard = await (await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers })).json() as { recentActivity: Array<{ kind: string; verdict?: string }> };
    const newActivity = dashboard.recentActivity.filter((entry) => entry.kind === "new");
    assert.ok(newActivity.some((entry) => entry.verdict === "unknown"), "verdict must survive into recent activity");
    assert.ok(newActivity.some((entry) => entry.verdict === undefined), "verdict-less new events remain supported");
  } finally { await app.close(); }
});

test("word level follows the proficiency ladder over HTTP", async () => {
  const app = await server();
  try {
    const make = async (title: string) => {
      const created = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers, body: JSON.stringify({ title, words: [{ word: "resilient", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] }] }) });
      const book = await created.json() as { id: string };
      const words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words`, { headers })).json() as Array<{ id: string; status: string; level: number }>;
      return { id: book.id, wordId: words[0]!.id, initialStatus: words[0]!.status, initialLevel: words[0]!.level };
    };
    const wordOf = async (bookId: string) => {
      const word = ((await (await fetch(`${app.baseUrl}/api/my/wordbooks/${bookId}/words`, { headers })).json()) as Array<{ status: string; level: number }>)[0]!;
      return { status: word.status, level: word.level };
    };
    const record = (bookId: string, body: Record<string, unknown>) => fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ wordbookId: bookId, ...body }) });

    // No events at all: the word is untouched at L0.
    const fresh = await make("未学习");
    assert.equal(fresh.initialStatus, "new");
    assert.equal(fresh.initialLevel, 0);

    // New words stay L0 for the first two consecutive recognition passes.
    const known = await make("连续认识");
    await record(known.id, { kind: "new", wordId: known.wordId, verdict: "know" });
    assert.deepEqual(await wordOf(known.id), { status: "new", level: 0 });
    await record(known.id, { kind: "new", wordId: known.wordId, verdict: "know" });
    assert.deepEqual(await wordOf(known.id), { status: "new", level: 0 });
    await record(known.id, { kind: "new", wordId: known.wordId, verdict: "unknown" });
    assert.deepEqual(await wordOf(known.id), { status: "new", level: 0 });
    for (let pass = 0; pass < 3; pass += 1) await record(known.id, { kind: "new", wordId: known.wordId, verdict: "know" });
    assert.deepEqual(await wordOf(known.id), { status: "learning", level: 1 });

    // Legacy verdict-less events count as recognition passes for compatibility.
    const legacy = await make("旧数据无判定");
    for (let pass = 0; pass < 3; pass += 1) await record(legacy.id, { kind: "new", wordId: legacy.wordId });
    assert.deepEqual(await wordOf(legacy.id), { status: "learning", level: 1 });

    // Flashcards climb one rung per 掌握 but can never pass L2 熟悉.
    const cards = await make("单词卡封顶");
    for (let pass = 0; pass < 3; pass += 1) await record(cards.id, { kind: "new", wordId: cards.wordId, verdict: "know" });
    await record(cards.id, { kind: "flashcard", wordId: cards.wordId, verdict: "know" });
    assert.deepEqual(await wordOf(cards.id), { status: "review", level: 2 });
    await record(cards.id, { kind: "flashcard", wordId: cards.wordId, verdict: "know" });
    assert.deepEqual(await wordOf(cards.id), { status: "review", level: 2 });

    // A correct dictation is the only way to L3 掌握; failures step one rung down with an L1 floor.
    await record(cards.id, { kind: "dictation", wordId: cards.wordId, correct: true });
    assert.deepEqual(await wordOf(cards.id), { status: "mastered", level: 3 });
    // A same-day second correct dictation does NOT reach L4 — the 7-day window has not passed.
    await record(cards.id, { kind: "dictation", wordId: cards.wordId, correct: true });
    assert.deepEqual(await wordOf(cards.id), { status: "mastered", level: 3 });
    await record(cards.id, { kind: "flashcard", wordId: cards.wordId, verdict: "unknown" });
    assert.deepEqual(await wordOf(cards.id), { status: "review", level: 2 });
    await record(cards.id, { kind: "dictation", wordId: cards.wordId, correct: false });
    await record(cards.id, { kind: "dictation", wordId: cards.wordId, correct: false });
    assert.deepEqual(await wordOf(cards.id), { status: "learning", level: 1 });

    // 标熟 jumps straight to the marked rung.
    const marked = await make("直接标熟");
    await record(marked.id, { kind: "mark", wordId: marked.wordId, level: 4 });
    assert.deepEqual(await wordOf(marked.id), { status: "mastered", level: 4 });

    // Dictation on an unstudied word never promotes (deck excludes it, but the event may exist).
    const dictationOnly = await make("未学直接听写");
    await record(dictationOnly.id, { kind: "dictation", wordId: dictationOnly.wordId, correct: true });
    assert.deepEqual(await wordOf(dictationOnly.id), { status: "new", level: 0 });

    // recentActivity reports the level the word held right AFTER each event (newest first),
    // so the dashboard's 结果 column can speak the ladder's vocabulary honestly.
    const traced = await make("结果档位");
    for (let pass = 0; pass < 3; pass += 1) await record(traced.id, { kind: "new", wordId: traced.wordId, verdict: "know" });
    await record(traced.id, { kind: "flashcard", wordId: traced.wordId, verdict: "know" });
    const dashboard = await (await fetch(`${app.baseUrl}/api/study/dashboard/${traced.id}`, { headers })).json() as { recentActivity: Array<{ kind: string; levelAfter: number }> };
    assert.deepEqual(
      dashboard.recentActivity.map((entry) => ({ kind: entry.kind, levelAfter: entry.levelAfter })),
      [{ kind: "flashcard", levelAfter: 2 }, { kind: "new", levelAfter: 1 }, { kind: "new", levelAfter: 0 }, { kind: "new", levelAfter: 0 }],
    );
  } finally { await app.close(); }
});

// --- Store-level ladder tests driven by a movable clock (InMemoryStudyStore injects `now`). ---

/** Single-word book built at the current clock; returns the book id and its only word id. */
async function singleWordBook(store: InMemoryStudyStore, title: string, word = "resilient"): Promise<{ id: string; wordId: string }> {
  const book = await store.createMyWordbook(CLIENT, { title, words: [{ word, phonetic: "", meanings: [], source: "user" }] });
  const wordId = (await store.listWords(CLIENT, book.id))![0]!.id;
  return { id: book.id, wordId };
}

test("store ladder: an L3 word promotes to L4 only once the 7-day final-check window has elapsed", async () => {
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => clock });
  const book = await singleWordBook(store, "七天终审");
  const level = async () => (await store.listWords(CLIENT, book.id))![0]!.level;
  for (let pass = 0; pass < 3; pass += 1) await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: book.wordId });
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: book.wordId, verdict: "know" });
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: book.wordId, correct: true });
  assert.equal(await level(), 3);

  // 6 days after reaching L3: a correct dictation still stays at L3.
  clock = new Date("2026-01-07T00:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: book.wordId, correct: true });
  assert.equal(await level(), 3);

  // 7 days after reaching L3: the correct dictation finally reaches L4.
  clock = new Date("2026-01-08T00:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: book.wordId, correct: true });
  assert.equal(await level(), 4);
});

test("store dashboard: finalCheckDue turns on at 7 days and clears again after the L4 promotion", async () => {
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => clock });
  const book = await singleWordBook(store, "终审待办");
  const finalCheckDue = async () => (await store.getDashboard(CLIENT, book.id))!.finalCheckDue;
  for (let pass = 0; pass < 3; pass += 1) await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: book.wordId });
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: book.wordId, verdict: "know" });
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: book.wordId, correct: true });
  assert.equal(await finalCheckDue(), 0); // just reached L3

  clock = new Date("2026-01-08T00:00:00.000Z");
  assert.equal(await finalCheckDue(), 1); // window has now passed

  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: book.wordId, correct: true }); // -> L4
  assert.equal(await finalCheckDue(), 0); // no longer an L3 word
});

test("store dashboard: 复习巩固 availability applies the L1(≥1d)/L2(≥2d) calendar-day due rule", async () => {
  let clock = new Date("2026-01-01T09:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => clock });
  // review.target == max(completedReview, availability); with only mark events (excluded from
  // completed tallies), completedReview stays 0 so target reads the availability directly.
  const reviewAvailable = async (id: string) => (await store.getDashboard(CLIENT, id))!.todayPlan.review.target;

  const l1 = await singleWordBook(store, "L1隔一天", "resilient");
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: l1.id, wordId: l1.wordId, level: 1 });
  const l2 = await singleWordBook(store, "L2隔两天", "empirical");
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: l2.id, wordId: l2.wordId, level: 2 });

  // Same calendar day as the last event: neither is due yet.
  assert.equal(await reviewAvailable(l1.id), 0);
  assert.equal(await reviewAvailable(l2.id), 0);

  clock = new Date("2026-01-02T09:00:00.000Z"); // +1 calendar day
  assert.equal(await reviewAvailable(l1.id), 1); // L1 due at ≥1 day
  assert.equal(await reviewAvailable(l2.id), 0); // L2 still needs ≥2 days

  clock = new Date("2026-01-03T09:00:00.000Z"); // +2 calendar days
  assert.equal(await reviewAvailable(l2.id), 1); // L2 now due
});

test("store: lastStudiedAt is the occurredAt of the latest event of any kind, mark included, and re-stamps", async () => {
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => clock });
  const book = await singleWordBook(store, "最后学习时间");
  const lastStudiedAt = async () => (await store.listWords(CLIENT, book.id))![0]!.lastStudiedAt;

  assert.equal(await lastStudiedAt(), undefined); // untouched word carries no stamp

  await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: book.wordId });
  assert.equal(await lastStudiedAt(), "2026-01-01T00:00:00.000Z");

  clock = new Date("2026-01-05T00:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: book.wordId, verdict: "know" });
  assert.equal(await lastStudiedAt(), "2026-01-05T00:00:00.000Z");

  // A later "mark" (which does not count as study effort) still re-stamps lastStudiedAt.
  clock = new Date("2026-01-09T00:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: book.id, wordId: book.wordId, level: 4 });
  assert.equal(await lastStudiedAt(), "2026-01-09T00:00:00.000Z");
});

test("store progress: levels tally l0..l4 and the weighted mastery percent", async () => {
  const store = new InMemoryStudyStore({ now: () => new Date("2026-01-01T00:00:00.000Z") });
  const book = await store.createMyWordbook(CLIENT, { title: "档位统计", words: [
    { word: "alpha", phonetic: "", meanings: [], source: "user" },
    { word: "bravo", phonetic: "", meanings: [], source: "user" },
    { word: "charlie", phonetic: "", meanings: [], source: "user" },
    { word: "delta", phonetic: "", meanings: [], source: "user" },
    { word: "echo", phonetic: "", meanings: [], source: "user" },
  ] });
  const items = (await store.listWords(CLIENT, book.id))!;
  const idOf = (word: string) => items.find((item) => item.word === word)!.id;
  // alpha stays L0. bravo -> L1. charlie -> L2. delta -> L3. echo -> L4 (mark).
  for (let pass = 0; pass < 3; pass += 1) await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: idOf("bravo") });
  for (let pass = 0; pass < 3; pass += 1) await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: idOf("charlie") });
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: idOf("charlie"), verdict: "know" });
  for (let pass = 0; pass < 3; pass += 1) await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: idOf("delta") });
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: idOf("delta"), verdict: "know" });
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: idOf("delta"), correct: true });
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: book.id, wordId: idOf("echo"), level: 4 });

  const bookCard = (await store.getMyWordbook(CLIENT, book.id))!;
  assert.deepEqual(bookCard.progress.levels, { l0: 1, l1: 1, l2: 1, l3: 1, l4: 1 });
  // (l1*0.25 + l2*0.5 + l3*0.75 + l4*1) / 5 = 2.5 / 5 = 50%.
  assert.equal(bookCard.progress.percent, 50);
  assert.deepEqual({ mastered: bookCard.progress.mastered, learning: bookCard.progress.learning, review: bookCard.progress.review, unstudied: bookCard.progress.unstudied }, { mastered: 2, learning: 1, review: 1, unstudied: 1 });
});

test("store dashboard: mark events stay out of week/calendar/streak yet surface in recentActivity with their level", async () => {
  const store = new InMemoryStudyStore({ now: () => new Date("2026-01-15T12:00:00.000Z") });
  const book = await singleWordBook(store, "标熟不计入统计");
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: book.id, wordId: book.wordId, level: 4 });
  const dashboard = (await store.getDashboard(CLIENT, book.id))!;
  assert.deepEqual(dashboard.week, { newCount: 0, reviewCount: 0, dictationCount: 0, total: 0 });
  assert.ok(dashboard.calendar.every((entry) => !entry.active));
  assert.equal(dashboard.streakDays, 0);
  const marks = dashboard.recentActivity.filter((entry) => entry.kind === "mark");
  assert.equal(marks.length, 1);
  assert.equal((marks[0] as { level: number }).level, 4);
});

test("store dashboard counts distinct words and keeps due-review totals stable", async () => {
  let clock = new Date("2026-01-01T12:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => clock });
  const book = await store.createMyWordbook(CLIENT, {
    title: "Distinct",
    words: [{ word: "resilient", phonetic: "", meanings: [], source: "user" }],
  });
  const [word] = (await store.listWords(CLIENT, book.id))!;
  await store.recordEvent(CLIENT, { kind: "mark", wordbookId: book.id, wordId: word!.id, level: 1 });
  clock = new Date("2026-01-03T12:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: word!.id, verdict: "know" });
  await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: book.id, wordId: word!.id, verdict: "know" });
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: word!.id, correct: true });
  await store.recordEvent(CLIENT, { kind: "dictation", wordbookId: book.id, wordId: word!.id, correct: true });
  const dashboard = (await store.getDashboard(CLIENT, book.id))!;
  assert.deepEqual(dashboard.todayPlan.review, { target: 1, completed: 1 });
  assert.equal(dashboard.todayPlan.dictation.completed, 1);
  assert.deepEqual(dashboard.week, { newCount: 0, reviewCount: 1, dictationCount: 1, total: 1 });
  assert.equal(dashboard.calendar.at(-1)?.count, 1);
});
