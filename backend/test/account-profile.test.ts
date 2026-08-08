import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryStudyStore } from "../src/study/store.js";
import type { StudyWordEntry } from "../src/study/types.js";

const CLIENT = "client-profile-0001";

function word(value: string): StudyWordEntry {
  return {
    word: value,
    phonetic: `/${value}/`,
    meanings: [{ pos: "noun", definition: `${value} definition` }],
    source: "user",
  };
}

async function fixture(store: InMemoryStudyStore) {
  const server: Server = createApp({ studyStore: store }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function register(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vocab-client-id": CLIENT },
    body: JSON.stringify({ username: "profile-user", password: "password-123" }),
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

test("account profile aggregates the account client, 90-day activity, streaks, and deleted history", async () => {
  let clock = new Date("2026-08-08T12:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => new Date(clock) });
  const app = await fixture(store);
  try {
    const cookie = await register(app.baseUrl);
    const live = await store.createMyWordbook(CLIENT, {
      title: "Live words",
      words: [word("alpha"), word("beta"), word("gamma")],
    });
    const deleted = await store.createMyWordbook(CLIENT, {
      title: "History words",
      words: [word("legacy")],
    });
    const liveWords = await store.listWords(CLIENT, live.id);
    const deletedWords = await store.listWords(CLIENT, deleted.id);
    assert.ok(liveWords && deletedWords);

    clock = new Date("2026-08-06T12:00:00.000Z");
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: live.id, wordId: liveWords[0]!.id, verdict: "know" });
    clock = new Date("2026-08-07T12:00:00.000Z");
    await store.recordEvent(CLIENT, { kind: "flashcard", wordbookId: live.id, wordId: liveWords[0]!.id, verdict: "know" });
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: live.id, wordId: liveWords[1]!.id, verdict: "know" });
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: deleted.id, wordId: deletedWords[0]!.id, verdict: "know" });
    clock = new Date("2026-08-08T12:00:00.000Z");
    await store.recordEvent(CLIENT, { kind: "mark", wordbookId: deleted.id, wordId: deletedWords[0]!.id, level: 4 });
    assert.equal(await store.deleteMyWordbook(CLIENT, deleted.id), true);

    const anonymous = await fetch(`${app.baseUrl}/api/account/profile`, {
      headers: { "x-vocab-client-id": CLIENT },
    });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: { code: "AUTH_REQUIRED", message: "No active account session" } });

    const response = await fetch(`${app.baseUrl}/api/account/profile`, {
      headers: { cookie, "x-vocab-client-id": "attacker-client-9999" },
    });
    assert.equal(response.status, 200);
    const profile = await response.json() as {
      metrics: { wordbookCount: number; wordCount: number; learnedWordCount: number; currentStreak: number; longestStreak: number };
      activityWindow: { startDate: string; endDate: string; days: number };
      activity: Array<{ date: string; count: number }>;
      recentActivity: Array<{ kind: string; wordbookTitle: string; levelAfter?: number }>;
    };
    assert.deepEqual(profile.metrics, {
      wordbookCount: 1,
      wordCount: 3,
      learnedWordCount: 2,
      currentStreak: 2,
      longestStreak: 2,
    });
    assert.deepEqual(profile.activityWindow, {
      startDate: "2026-05-11",
      endDate: "2026-08-08",
      days: 90,
    });
    assert.equal(profile.activity.length, 90);
    assert.equal(profile.activity.find((entry) => entry.date === "2026-08-06")?.count, 1);
    assert.equal(profile.activity.find((entry) => entry.date === "2026-08-07")?.count, 3);
    assert.equal(profile.activity.find((entry) => entry.date === "2026-08-08")?.count, 0);
    assert.equal(profile.recentActivity.length, 5);
    const mark = profile.recentActivity[0]!;
    assert.equal(mark.kind, "mark");
    assert.equal(mark.wordbookTitle, "History words");
    assert.equal(mark.levelAfter, 4);
    assert.equal(profile.recentActivity.some((entry) => entry.wordbookTitle === "History words"), true);
    assert.equal(profile.recentActivity.every((entry) => entry.levelAfter !== undefined), true);
  } finally {
    await app.close();
  }
});
