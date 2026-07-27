import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryEngagementStore, SqliteEngagementStore } from "../src/engagement/store.js";

test("popular searches use the rolling window, count repeats, and sort ties alphabetically", async () => {
  let now = new Date("2026-07-28T12:00:00.000Z");
  const store = new MemoryEngagementStore(() => now);
  await store.recordSearch("zebra");
  await store.recordSearch("zebra");
  await store.recordSearch("apple");
  now = new Date("2026-07-29T12:00:00.000Z");
  await store.recordSearch("banana");
  await store.recordSearch("apple");

  assert.deepEqual(
    await store.listPopularSearches(new Date("2026-07-28T11:59:59.000Z"), 8),
    [
      { word: "apple", count: 2 },
      { word: "zebra", count: 2 },
      { word: "banana", count: 1 },
    ],
  );
  assert.deepEqual(
    await store.listPopularSearches(new Date("2026-07-29T00:00:00.000Z"), 8),
    [
      { word: "apple", count: 1 },
      { word: "banana", count: 1 },
    ],
  );
});

test("SQLite engagement data survives reopening without modifying study tables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-engagement-"));
  const file = join(directory, "state.sqlite");
  try {
    const first = new SqliteEngagementStore(file, () => new Date("2026-07-28T12:00:00.000Z"));
    await first.recordSearch("resilient");
    const created = await first.createFeedback({
      type: "suggestion",
      message: "希望增加例句收藏。",
      contact: "reader@example.test",
      page: "/wordbook",
    });
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    first.close();

    const second = new SqliteEngagementStore(file, () => new Date("2026-07-29T12:00:00.000Z"));
    assert.deepEqual(
      await second.listPopularSearches(new Date("2026-07-22T12:00:00.000Z"), 8),
      [{ word: "resilient", count: 1 }],
    );
    second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
