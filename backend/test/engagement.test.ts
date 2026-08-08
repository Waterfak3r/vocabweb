import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryEngagementStore, SqliteEngagementStore } from "../src/engagement/store.js";

test("popular searches rank by week-over-week trend so new words displace cooling ones", async () => {
  let now = new Date("2026-07-15T12:00:00.000Z");
  const store = new MemoryEngagementStore(() => now);
  await store.recordSearch("zebra");
  await store.recordSearch("zebra");
  await store.recordSearch("zebra");
  now = new Date("2026-07-25T12:00:00.000Z");
  await store.recordSearch("apple");
  await store.recordSearch("apple");
  await store.recordSearch("zebra");
  await store.recordSearch("banana");
  await store.recordSearch("cherry");

  // zebra was the previous week's hot word (3 searches) but cooled off; apple and
  // banana are new this week, so they displace it despite lower cumulative counts.
  assert.deepEqual(
    await store.listPopularSearches(new Date("2026-07-21T12:00:00.000Z"), new Date("2026-07-14T12:00:00.000Z"), 8),
    [
      { word: "apple", count: 2, trend: 2 },
      { word: "banana", count: 1, trend: 1 },
      { word: "cherry", count: 1, trend: 1 },
      { word: "zebra", count: 1, trend: -2 },
    ],
  );
  // A narrower current window drops zebra's previous searches from the comparison,
  // leaving a three-way tie on trend, broken alphabetically.
  assert.deepEqual(
    await store.listPopularSearches(new Date("2026-07-24T00:00:00.000Z"), new Date("2026-07-17T00:00:00.000Z"), 8),
    [
      { word: "apple", count: 2, trend: 2 },
      { word: "banana", count: 1, trend: 1 },
      { word: "cherry", count: 1, trend: 1 },
      { word: "zebra", count: 1, trend: 1 },
    ],
  );
});

test("SQLite engagement data survives reopening without modifying study tables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vacab-engagement-"));
  const file = join(directory, "state.sqlite");
  try {
    const first = new SqliteEngagementStore(file, () => new Date("2026-07-15T12:00:00.000Z"));
    await first.recordSearch("resilient");
    await first.recordSearch("resilient");
    const created = await first.createFeedback({
      type: "suggestion",
      message: "希望增加例句收藏。",
      contact: "reader@example.test",
      page: "/wordbook",
    });
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    first.close();

    const second = new SqliteEngagementStore(file, () => new Date("2026-07-25T12:00:00.000Z"));
    await second.recordSearch("resilient");
    await second.recordSearch("grit");
    assert.deepEqual(
      await second.listPopularSearches(new Date("2026-07-21T12:00:00.000Z"), new Date("2026-07-14T12:00:00.000Z"), 8),
      [
        { word: "grit", count: 1, trend: 1 },
        { word: "resilient", count: 1, trend: -1 },
      ],
    );
    second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
