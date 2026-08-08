import assert from "node:assert/strict";
import { test } from "node:test";
import {
  card,
  eventsByWordbook,
  ladderEventLevels,
  ladderReplay,
  ladderStates,
  progress,
  progressFromStates,
} from "../src/study/ladder.js";
import type { LearningEvent, MyWordbook } from "../src/study/types.js";

const book: MyWordbook = {
  id: "book-a",
  title: "A",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  words: [{ id: "word-a", addedAt: "2026-01-01T00:00:00.000Z", word: "alpha", phonetic: "", meanings: [], source: "user" }],
};

const events: LearningEvent[] = [
  { id: "event-a-1", kind: "new", wordbookId: "book-a", wordId: "word-a", word: "alpha", occurredAt: "2026-01-01T00:00:00.000Z", verdict: "know" },
  { id: "event-b-1", kind: "new", wordbookId: "book-b", wordId: "word-b", word: "beta", occurredAt: "2026-01-02T00:00:00.000Z", verdict: "know" },
  { id: "event-a-2", kind: "flashcard", wordbookId: "book-a", wordId: "word-a", word: "alpha", occurredAt: "2026-01-03T00:00:00.000Z", verdict: "know" },
];

test("wordbook event grouping keeps insertion order and isolates histories", () => {
  const grouped = eventsByWordbook(events);
  assert.deepEqual(grouped.get("book-a")?.map((event) => event.id), ["event-a-1", "event-a-2"]);
  assert.deepEqual(grouped.get("book-b")?.map((event) => event.id), ["event-b-1"]);
});

test("combined ladder replay matches the independent state and event-level views", () => {
  const combined = ladderReplay(events.filter((event) => event.wordbookId === book.id));
  assert.deepEqual(combined.states, ladderStates(events.filter((event) => event.wordbookId === book.id)));
  assert.deepEqual(combined.eventLevels, ladderEventLevels(events.filter((event) => event.wordbookId === book.id)));

  const expectedProgress = progress(book, events.filter((event) => event.wordbookId === book.id));
  assert.deepEqual(progressFromStates(book, combined.states), expectedProgress);
  assert.deepEqual(card(book, [], expectedProgress).progress, expectedProgress);
});
