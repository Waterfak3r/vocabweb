import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryStudyStore, JsonFileStudyStore } from "../src/study/store.js";

const CLIENT = "client-12345678";
const OTHER_CLIENT = "client-87654321";
const headers = { "x-vocab-client-id": CLIENT, "content-type": "application/json" };

async function server() {
  const http: Server = createApp({ studyStore: new InMemoryStudyStore() }).listen(0);
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())),
  };
}

test("catalog supports filtering, favorites, and idempotent add-to-mine", async () => {
  const app = await server();
  try {
    const denied = await fetch(`${app.baseUrl}/api/catalog/wordbooks`);
    assert.equal(denied.status, 400);

    const search = await fetch(`${app.baseUrl}/api/catalog/wordbooks?exam=IELTS&sort=rating`, { headers });
    assert.equal(search.status, 200);
    const cards = await search.json() as Array<{ id: string; title: string; favorited: boolean; added: boolean; uploaded: boolean }>;
    assert.equal(cards.length, 4);
    const core = cards.find((card) => card.id === "catalog-ielts-core");
    assert.equal(core?.title, "IELTS 核心词汇");
    assert.equal(core?.favorited, true);
    assert.equal(core?.uploaded, false);
    const id = core!.id;

    const favorites = await fetch(`${app.baseUrl}/api/catalog/favorites`, { headers });
    assert.equal((await favorites.json() as unknown[]).length, 2);
    const allCatalog = await fetch(`${app.baseUrl}/api/catalog/wordbooks`, { headers });
    assert.equal((await allCatalog.json() as unknown[]).length, 7);

    const favorite = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers });
    assert.deepEqual(await favorite.json(), { favorited: false });
    const favoriteAgain = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/favorite`, { method: "POST", headers });
    assert.deepEqual(await favoriteAgain.json(), { favorited: true });
    const added = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers });
    assert.equal(added.status, 201);
    const first = await added.json() as { wordbook: { id: string; wordCount: number }; created: boolean };
    assert.equal(first.created, true);
    assert.equal(first.wordbook.wordCount, 5);
    const repeated = await fetch(`${app.baseUrl}/api/catalog/wordbooks/${id}/add`, { method: "POST", headers });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json() as { created: boolean }).created, false);

    const mine = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers });
    assert.equal((await mine.json() as unknown[]).length, 7);
    const isolated = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers: { "x-vocab-client-id": OTHER_CLIENT } });
    assert.equal((await isolated.json() as unknown[]).length, 6);
  } finally { await app.close(); }
});

test("a new anonymous client receives the default workbench and can study its primary wordbook", async () => {
  const app = await server();
  try {
    const books = await fetch(`${app.baseUrl}/api/my/wordbooks`, { headers });
    const list = await books.json() as Array<{ id: string; wordCount: number }>;
    const primary = list.find((book) => book.id === "my-writing-task-2");
    assert.equal(list.length, 6);
    assert.ok(primary && primary.wordCount > 0);
    const queue = await fetch(`${app.baseUrl}/api/my/wordbooks/my-writing-task-2/words`, { headers });
    const words = await queue.json() as Array<{ word: string }>;
    const event = await fetch(`${app.baseUrl}/api/study/events`, { method: "POST", headers, body: JSON.stringify({ kind: "flashcard", wordbookId: "my-writing-task-2", word: words[0]!.word, verdict: "know" }) });
    assert.equal(event.status, 201);
    const dashboard = await fetch(`${app.baseUrl}/api/study/dashboard/my-writing-task-2`, { headers });
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
    const created = await fetch(`${app.baseUrl}/api/catalog/wordbooks/catalog-ielts-core/add`, { method: "POST", headers });
    const book = (await created.json() as { wordbook: { id: string } }).wordbook;
    const words = await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}/words?status=new`, { headers });
    const queue = await words.json() as Array<{ word: string; status: string }>;
    assert.equal(queue.length, 5);

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
    assert.match(raw, /"version": 2/);
    const reloaded = new JsonFileStudyStore(file);
    assert.equal((await reloaded.listMyWordbooks(CLIENT, false)).length, 9);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("JSON store upgrades an older catalog without overwriting existing catalog or client data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-study-upgrade-"));
  const file = join(directory, "state.json");
  try {
    const original = new JsonFileStudyStore(file);
    await original.listCatalog(CLIENT, {});
    await original.createMyWordbook(CLIENT, { title: "保留的自定义词本" });
    const legacy = JSON.parse(await readFile(file, "utf8")) as { version: number; catalog: Array<{ title: string }>; clients: Record<string, unknown> };
    legacy.catalog = legacy.catalog.slice(0, 4);
    legacy.catalog[0]!.title = "保留的自定义 IELTS 核心词汇";
    await writeFile(file, `${JSON.stringify(legacy)}\n`, "utf8");

    const upgraded = new JsonFileStudyStore(file);
    const catalog = await upgraded.listCatalog(CLIENT, {});
    assert.equal(catalog.length, 7);
    assert.equal(catalog.find((book) => book.id === "catalog-ielts-core")?.title, "保留的自定义 IELTS 核心词汇");
    assert.ok((await upgraded.listMyWordbooks(CLIENT, false)).some((book) => book.title === "保留的自定义词本"));
    assert.equal((JSON.parse(await readFile(file, "utf8")) as { catalog: unknown[] }).catalog.length, 7);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
