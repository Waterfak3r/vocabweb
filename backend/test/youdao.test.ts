import assert from "node:assert/strict";
import { test } from "node:test";
import { YoudaoPronunciationProvider } from "../src/providers/youdao.js";

test("Youdao pronunciation maps British and American accents", async () => {
  const british = await new YoudaoPronunciationProvider({ accent: "gb" }).lookup("water");
  const american = await new YoudaoPronunciationProvider({ accent: "us" }).lookup("water");

  assert.equal(british?.audioUrl, "https://dict.youdao.com/dictvoice?audio=water&type=1");
  assert.equal(american?.audioUrl, "https://dict.youdao.com/dictvoice?audio=water&type=2");
  assert.deepEqual(british, {
    word: "water",
    phonetic: "",
    audioUrl: "https://dict.youdao.com/dictvoice?audio=water&type=1",
    meanings: [],
    source: "backend",
  });
});

test("Youdao pronunciation normalizes and safely encodes a valid query", async () => {
  const provider = new YoudaoPronunciationProvider({
    accent: "us",
    baseUrl: "https://audio.example/dictvoice",
  });

  const entry = await provider.lookup("  Don't   give-up (phr) ");

  assert.equal(entry?.word, "don't give-up (phr)");
  assert.equal(
    entry?.audioUrl,
    "https://audio.example/dictvoice?audio=don%27t+give-up+%28phr%29&type=2",
  );
});

test("Youdao pronunciation returns null for invalid queries without network access", async () => {
  const provider = new YoudaoPronunciationProvider();

  assert.equal(await provider.lookup("water?"), null);
  assert.equal(await provider.lookup("中文"), null);
  assert.equal(await provider.lookup("   "), null);
});

test("Youdao pronunciation only accepts HTTPS base URLs", () => {
  assert.throws(
    () => new YoudaoPronunciationProvider({ baseUrl: "http://dict.example/dictvoice" }),
    /HTTPS/,
  );
  assert.throws(
    () => new YoudaoPronunciationProvider({ baseUrl: "not a URL" }),
    /HTTPS URL/,
  );
});
