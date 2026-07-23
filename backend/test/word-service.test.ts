import assert from "node:assert/strict";
import { test } from "node:test";
import { WordService } from "../src/words/word-service.js";
import type { WordEntry, WordProvider } from "../src/words/types.js";

function entry(word: string): WordEntry {
  return {
    word,
    phonetic: "",
    meanings: [{ pos: "noun", definition: `Definition of ${word}` }],
    source: "backend",
  };
}

test("WordService caches successful lookups until TTL expiry", async () => {
  let now = 1_000;
  let calls = 0;
  const provider: WordProvider = {
    async lookup(word) {
      calls += 1;
      return entry(word);
    },
  };
  const service = new WordService(provider, {
    cacheTtlMs: 100,
    cacheMaxEntries: 2,
    now: () => now,
  });

  assert.equal((await service.lookup(" Test "))?.word, "test");
  assert.equal((await service.lookup("test"))?.word, "test");
  assert.equal(calls, 1);

  now += 101;
  await service.lookup("test");
  assert.equal(calls, 2);
});

test("WordService does not cache misses", async () => {
  let calls = 0;
  const service = new WordService(
    {
      async lookup() {
        calls += 1;
        return null;
      },
    },
    { cacheMaxEntries: 1 },
  );

  await service.lookup("missing");
  await service.lookup("missing");
  assert.equal(calls, 2);
});

test("WordService deduplicates concurrent requests for the same normalized word", async () => {
  let calls = 0;
  let resolveProvider: ((value: WordEntry) => void) | undefined;
  const providerResult = new Promise<WordEntry>((resolve) => {
    resolveProvider = resolve;
  });
  const service = new WordService(
    {
      async lookup() {
        calls += 1;
        return providerResult;
      },
    },
    { cacheMaxEntries: 2 },
  );

  const first = service.lookup("Concurrent");
  const second = service.lookup(" concurrent ");
  assert.equal(calls, 1);

  resolveProvider?.(entry("concurrent"));
  assert.deepEqual(await Promise.all([first, second]), [
    entry("concurrent"),
    entry("concurrent"),
  ]);
});

test("WordService evicts the least recently used entry at capacity", async () => {
  const calls = new Map<string, number>();
  const service = new WordService(
    {
      async lookup(word) {
        calls.set(word, (calls.get(word) ?? 0) + 1);
        return entry(word);
      },
    },
    { cacheMaxEntries: 2 },
  );

  await service.lookup("alpha");
  await service.lookup("beta");
  await service.lookup("alpha");
  await service.lookup("gamma");
  await service.lookup("beta");

  assert.equal(calls.get("alpha"), 1);
  assert.equal(calls.get("beta"), 2);
  assert.equal(calls.get("gamma"), 1);
});
