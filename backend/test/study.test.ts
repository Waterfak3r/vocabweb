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

    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST",
      headers,
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

    const filteredCatalog = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=IELTS`, { headers });
    assert.deepEqual((await filteredCatalog.json() as Array<{ id: string }>).map((card) => card.id), [id]);

    const favorite = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers });
    assert.deepEqual(await favorite.json(), { favorited: true });
    const favoriteAgain = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers });
    assert.deepEqual(await favoriteAgain.json(), { favorited: false });
    const added = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers });
    assert.equal(added.status, 201);
    const first = await added.json() as { wordbook: { id: string; wordCount: number }; created: boolean };
    assert.equal(first.created, true);
    assert.equal(first.wordbook.wordCount, 2);
    const repeated = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json() as { created: boolean }).created, false);

    const mine = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers });
    assert.equal((await mine.json() as unknown[]).length, 1);
    const isolated = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers: { "x-vocab-client-id": OTHER_CLIENT } });
    assert.deepEqual(await isolated.json(), []);
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
    assert.deepEqual(pristine.todayPlan, { new: { target: 1, completed: 0 }, review: { target: 0, completed: 0 }, dictation: { target: 1, completed: 0 } });
    assert.deepEqual(pristine.week, { newCount: 0, reviewCount: 0, dictationCount: 0, total: 0 });
    assert.equal(pristine.streakDays, 0);
    const queue = await fetch(`${app.baseUrl}/api/my/wordbooks/${primary.id}/words`, { headers });
    const words = await queue.json() as Array<{ word: string }>;
    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: primary.id, word: words[0]!.word, verdict: "know" }) });
    assert.equal(event.status, 201);
    const dashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${primary.id}`, { headers });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json() as { todayPlan: { review: { completed: number } } }).todayPlan.review.completed, 1);
  } finally { await app.close(); }
});

test("study routes reject malformed inputs and events outside the selected wordbook", async () => {
  const app = await server();
  try {
    const invalidQuery = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=not-an-exam`, { headers });
    assert.equal(invalidQuery.status, 400);
    const invalidUpload = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers, body: JSON.stringify({ title: "" }) });
    assert.equal(invalidUpload.status, 400);
    const invalidEvent = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: "my-not-real", word: "test" }) });
    assert.equal(invalidEvent.status, 400);
    const unknownWord = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "new", wordbookId: "my-not-real", word: "test" }) });
    assert.equal(unknownWord.status, 404);
  } finally { await app.close(); }
});

test("study events drive queues and the selected-wordbook dashboard", async () => {
  const app = await server();
  try {
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "练习词库",
        words: [
          { word: "resilient", phonetic: "/rɪˈzɪliənt/", source: "user", meanings: [{ pos: "adjective", definition: "Able to recover quickly." }] },
          { word: "empirical", phonetic: "/ɪmˈpɪrɪkəl/", source: "user", meanings: [{ pos: "adjective", definition: "Based on observation." }] },
        ],
      }),
    });
    assert.equal(upload.status, 201);
    const catalog = await upload.json() as { id: string };
    const created = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers });
    assert.equal(created.status, 201);
    const book = (await created.json() as { wordbook: { id: string } }).wordbook;
    const words = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words?status=new`, { headers });
    const queue = await words.json() as Array<{ word: string; status: string }>;
    assert.equal(queue.length, 2);

    const flashcard = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: book.id, word: queue[0]!.word, verdict: "know" }) });
    assert.equal(flashcard.status, 201);
    const dictation = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "dictation", wordbookId: book.id, word: queue[1]!.word, correct: false }) });
    assert.equal(dictation.status, 201);
    const dashboard = await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers });
    const data = await dashboard.json() as { wordbook: { progress: { mastered: number; review: number } }; todayPlan: { review: { completed: number }; dictation: { completed: number } }; recentActivity: unknown[]; calendar: unknown[] };
    assert.equal(data.wordbook.progress.mastered, 1);
    assert.equal(data.wordbook.progress.review, 1);
    assert.equal(data.todayPlan.review.completed, 1);
    assert.equal(data.todayPlan.dictation.completed, 1);
    assert.equal(data.recentActivity.length, 2);
    assert.equal(data.calendar.length, 7);
  } finally { await app.close(); }
});

test("upload, share-code import, recycle bin, and restore form a usable collection loop", async () => {
  const app = await server();
  try {
    const upload = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers, body: JSON.stringify({ title: "我的学术词库", description: "自定义", exams: ["IELTS"], goals: ["写作"], words: [{ word: "coherent", phonetic: "", source: "user", meanings: [{ pos: "adjective", definition: "Logical and consistent." }] }] }) });
    assert.equal(upload.status, 201);
    const catalog = await upload.json() as { shareCode: string; id: string; uploaded: boolean };
    assert.equal(catalog.uploaded, true);
    const imported = await fetch(`${app.baseUrl}/api/catalog/imports`, { method: "POST", headers, body: JSON.stringify({ shareCode: catalog.shareCode }) });
    assert.equal(imported.status, 201);
    const wordbook = (await imported.json() as { wordbook: { id: string } }).wordbook;
    const deleted = await fetch(`${app.baseUrl}/api/my/wordbooks/${wordbook.id}`, { method: "DELETE", headers });
    assert.equal(deleted.status, 204);
    const trash = await fetch(`${app.baseUrl}/api/my/wordbooks?view=trash`, { headers });
    assert.equal((await trash.json() as unknown[]).length, 1);
    const restored = await fetch(`${app.baseUrl}/api/my/wordbooks/${wordbook.id}/restore`, { method: "POST", headers });
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
    assert.match(raw, /"version": 3/);
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
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      version: 3,
      catalog: [],
      clients: { [CLIENT]: { favorites: [], wordbooks: [], events: [], drafts: [] } },
    });
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

test("import drafts preserve Chinese input, batch 501 valid words, and append later drafts to one wordbook", async () => {
  const app = await server({
    wordLookup: { async lookup(word) { return word === "missing" ? null : dictionaryEntry(word); } },
    localChineseLookup: { async lookup(word) { return word === "fallback" ? "本地中文释义" : undefined; } },
  });
  try {
    const words = Array.from({ length: 501 }, (_, index) => alphabeticWord(index));
    const response = await fetch(`${app.baseUrl}/api/my/import-drafts`, {
      method: "POST", headers,
      body: JSON.stringify({ title: "分批导入", lines: [{ line: 1, word: "resilient", zhMeaning: "坚韧的" }, { line: 2, word: "fallback" }, ...words.map((word, index) => ({ line: index + 3, word }))] }),
    });
    assert.equal(response.status, 201);
    const first = await response.json() as { id: string; entries: unknown[]; batchIndex: number; totalBatches: number };
    assert.equal(first.batchIndex, 1);
    assert.equal(first.totalBatches, 2);
    assert.equal(first.entries.length, 500);
    const drafts = await (await fetch(`${app.baseUrl}/api/my/import-drafts`, { headers })).json() as Array<{
      id: string; batchIndex: number; targetWordbookId?: string;
      entries: Array<{ word: string; entry: { zhMeaning?: string; zhMeaningSource?: string } }>;
    }>;
    assert.equal(drafts.length, 2);
    const custom = drafts.flatMap((draft) => draft.entries).find((entry) => entry.word === "resilient")!;
    assert.deepEqual(custom.entry.zhMeaning, "坚韧的");
    assert.equal(custom.entry.zhMeaningSource, "user");
    const fallback = drafts.flatMap((draft) => draft.entries).find((entry) => entry.word === "fallback")!;
    assert.equal(fallback.entry.zhMeaning, "本地中文释义");
    assert.equal(fallback.entry.zhMeaningSource, "dictionary");
    const firstCommit = await fetch(`${app.baseUrl}/api/my/import-drafts/${first.id}/commit`, { method: "POST", headers, body: "{}" });
    assert.equal(firstCommit.status, 200);
    const firstBook = await firstCommit.json() as { id: string; wordCount: number };
    assert.equal(firstBook.wordCount, 500);
    const next = drafts.find((draft) => draft.batchIndex === 2)!;
    const secondCommit = await fetch(`${app.baseUrl}/api/my/import-drafts/${next.id}/commit`, { method: "POST", headers, body: "{}" });
    const complete = await secondCommit.json() as { id: string; wordCount: number };
    assert.equal(complete.id, firstBook.id);
    assert.equal(complete.wordCount, 503);
    const linked = await (await fetch(`${app.baseUrl}/api/my/import-drafts/${next.id}`, { headers })).json() as { targetWordbookId: string };
    assert.equal(linked.targetWordbookId, firstBook.id);
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
    const create = await fetch(`${app.baseUrl}/api/my/wordbooks`, { method: "POST", headers, body: JSON.stringify({ title: "私有词本", words: [dictionaryEntry("resilient")] }) });
    const privateBook = await create.json() as { id: string };
    const conflict = await fetch(`${app.baseUrl}/api/my/import-drafts`, { method: "POST", headers, body: JSON.stringify({ title: "不会新建", targetWordbookId: privateBook.id, lines: [{ line: 1, word: "resilient", zhMeaning: "有韧性" }] }) });
    const draft = await conflict.json() as { id: string; entries: Array<{ id: string; status: string }> };
    assert.equal(draft.entries[0]!.status, "conflict");
    const merged = await fetch(`${app.baseUrl}/api/my/import-drafts/${draft.id}/commit`, { method: "POST", headers, body: JSON.stringify({ resolutions: { [draft.entries[0]!.id]: "merge" } }) });
    assert.equal(merged.status, 200);
    let words = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words`, { headers })).json() as Array<{ id: string; word: string; zhMeaning?: string; status: string }>;
    const initial = words[0]!;
    assert.equal(initial.zhMeaning, "有韧性");
    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: privateBook.id, wordId: initial.id, verdict: "know" }) });
    assert.equal(event.status, 201);
    const renamed = await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words/${initial.id}`, { method: "PATCH", headers, body: JSON.stringify({ word: "durable" }) });
    assert.equal(renamed.status, 200);
    assert.deepEqual((await renamed.json() as { id: string; word: string }).id, initial.id);
    const masteredWords = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words?status=mastered`, { headers })).json() as Array<{ word: string }>;
    assert.deepEqual(masteredWords.map((word) => word.word), ["durable"]);
    assert.ok(lookedUp.includes("durable"));

    const published = await fetch(`${app.baseUrl}/api/catalog/uploads`, { method: "POST", headers, body: JSON.stringify({ sourceWordbookId: privateBook.id, title: "社区快照" }) });
    const catalog = await published.json() as { id: string };
    assert.equal(published.status, 201);
    const changed = await fetch(`${app.baseUrl}/api/my/wordbooks/${privateBook.id}/words/${initial.id}`, { method: "PATCH", headers, body: JSON.stringify({ zhMeaning: "之后的私有修改" }) });
    assert.equal(changed.status, 200);
    const otherHeaders = { ...headers, "x-vocab-client-id": OTHER_CLIENT };
    const oldCopy = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}/add`, { method: "POST", headers: otherHeaders });
    const oldBook = (await oldCopy.json() as { wordbook: { id: string } }).wordbook;
    const oldWords = await (await fetch(`${app.baseUrl}/api/my/wordbooks/${oldBook.id}/words`, { headers: otherHeaders })).json() as Array<{ zhMeaning?: string }>;
    assert.equal(oldWords[0]!.zhMeaning, "有韧性");
    const refreshed = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${catalog.id}`, { method: "PATCH", headers, body: JSON.stringify({ sourceWordbookId: privateBook.id }) });
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
    assert.equal(words?.[0]?.status, "mastered");
    await store.listMyWordbooks(CLIENT, false);
    const persisted = JSON.parse(await readFile(file, "utf8")) as { version: number; clients: Record<string, { wordbooks: Array<{ words: Array<{ id?: string }> }>; events: Array<{ wordId?: string }> }> };
    assert.equal(persisted.version, 3);
    assert.ok(persisted.clients[CLIENT]!.wordbooks[0]!.words[0]!.id);
    assert.equal(persisted.clients[CLIENT]!.events[0]!.wordId, persisted.clients[CLIENT]!.wordbooks[0]!.words[0]!.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
