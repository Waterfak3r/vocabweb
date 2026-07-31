import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { InMemoryStudyStore } from "../src/study/store.js";
import type { StudyRound, WordbookStudyPreferences } from "../src/study/types.js";

const CLIENT = "round-client-12345678";

function entry(word: string, definition = `${word} definition`, zhMeaning = `${word} 中文释义`) {
  return {
    word,
    phonetic: "",
    source: "user" as const,
    meanings: [{ pos: "verb", definition }],
    zhMeaning,
    zhMeaningSource: "user" as const,
  };
}

async function server() {
  const store = new InMemoryStudyStore();
  const http: Server = createApp({ studyStore: store }).listen(0);
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address() as AddressInfo;
  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())),
  };
}

async function register(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "x-vocab-client-id": CLIENT, "content-type": "application/json" },
    body: JSON.stringify({ username: "round-user", password: "password-123" }),
  });
  assert.equal(response.status, 201);
  return {
    "content-type": "application/json",
    "x-vocab-client-id": CLIENT,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}

test("study rounds preserve exact cross-device order and require both enabled exercises", async () => {
  const app = await server();
  try {
    const firstDevice = await register(app.baseUrl);
    const secondDevice = { ...firstDevice, "x-vocab-client-id": "round-device-22222222" };
    const createdResponse = await fetch(`${app.baseUrl}/api/my/wordbooks`, {
      method: "POST",
      headers: firstDevice,
      body: JSON.stringify({
        title: "Synced round",
        words: [
          entry("connect", "join together"),
          entry("disconnect", "break a connection"),
          entry("connection", "a link between things"),
          entry("reconnect", "connect again"),
        ],
      }),
    });
    const book = await createdResponse.json() as { id: string };
    const preferences: WordbookStudyPreferences = {
      plan: { newWords: 4, dictation: 0, backlogReviews: 1 },
      modes: {
        new: {
          meaningPreference: "en",
          showExamples: true,
          showPhonetic: true,
          autoPlayAudio: false,
          exerciseTypes: ["self-rating", "meaning-choice"],
        },
        review: {
          meaningPreference: "en",
          showExamples: true,
          showPhonetic: true,
          autoPlayAudio: false,
          exerciseTypes: ["self-rating", "meaning-choice"],
        },
        dictation: {
          meaningPreference: "en",
          showExamples: true,
          showPhonetic: false,
          autoPlayAudio: false,
          underlineMistakes: true,
          showMeaning: true,
          showCharacterMask: false,
        },
      },
    };
    assert.equal((await fetch(`${app.baseUrl}/api/my/wordbooks/${book.id}`, {
      method: "PATCH",
      headers: firstDevice,
      body: JSON.stringify({ studyPreferences: preferences }),
    })).status, 200);

    const startedResponse = await fetch(`${app.baseUrl}/api/study/rounds`, {
      method: "POST",
      headers: firstDevice,
      body: JSON.stringify({ wordbookId: book.id, mode: "new" }),
    });
    assert.equal(startedResponse.status, 201);
    let round = (await startedResponse.json() as { round: StudyRound }).round;
    assert.equal(round.wordIds.length, 4);
    assert.equal(round.queue.length, 8);
    assert.deepEqual(round.queue.slice(0, 4).map((task) => task.exercise), Array(4).fill("self-rating"));
    assert.deepEqual(round.queue.slice(4).map((task) => task.exercise), Array(4).fill("meaning-choice"));

    const resumedResponse = await fetch(`${app.baseUrl}/api/study/rounds`, {
      method: "POST",
      headers: secondDevice,
      body: JSON.stringify({ wordbookId: book.id, mode: "new" }),
    });
    assert.equal(resumedResponse.status, 200);
    const resumed = await resumedResponse.json() as { round: StudyRound; resumed: boolean };
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.round.id, round.id);
    assert.deepEqual(resumed.round.queue, round.queue);

    // Pass the recall-judgment lane. No word is complete until its meaning choice also passes.
    for (let index = 0; index < 4; index += 1) {
      const answer = await fetch(`${app.baseUrl}/api/study/rounds/${round.id}/answers`, {
        method: "POST",
        headers: firstDevice,
        body: JSON.stringify({
          taskId: round.queue[0]!.id,
          response: "know",
          operationId: randomUUID(),
          revision: round.revision,
        }),
      });
      assert.equal(answer.status, 200);
      round = await answer.json() as StudyRound;
      assert.equal(round.completedWordIds.length, 0);
    }
    assert.equal(round.queue[0]?.exercise, "meaning-choice");

    const optionsResponse = await fetch(
      `${app.baseUrl}/api/study/rounds/${round.id}/tasks/${round.queue[0]!.id}/options`,
      { headers: secondDevice },
    );
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json() as { wordId: string; options: Array<{ wordId: string; word: string; definition: string }> };
    assert.equal(options.options.length, 4);
    assert.ok(options.options.some((option) => option.wordId === options.wordId));
    assert.ok(options.options.some((option) => option.word === "connect" || option.word === "disconnect" || option.word === "reconnect"));
    assert.ok(options.options.every((option) => !option.definition.includes("中文释义")));

    const chineseOptionsResponse = await fetch(
      `${app.baseUrl}/api/study/rounds/${round.id}/tasks/${round.queue[0]!.id}/options?meaningPreference=zh`,
      { headers: secondDevice },
    );
    assert.equal(chineseOptionsResponse.status, 200);
    const chineseOptions = await chineseOptionsResponse.json() as {
      options: Array<{ definition: string }>;
    };
    assert.equal(chineseOptions.options.length, 4);
    assert.ok(chineseOptions.options.every((option) => option.definition.includes("中文释义")));

    // An incorrect choice is recorded and the same exercise returns at the end with a fresh task id.
    const failedTask = round.queue[0]!;
    round = await (await fetch(`${app.baseUrl}/api/study/rounds/${round.id}/answers`, {
      method: "POST",
      headers: firstDevice,
      body: JSON.stringify({
        taskId: failedTask.id,
        response: "incorrect",
        operationId: randomUUID(),
        revision: round.revision,
      }),
    })).json() as StudyRound;
    assert.ok(round.unknownWordIds.includes(failedTask.wordId));
    assert.equal(round.queue.at(-1)?.wordId, failedTask.wordId);
    assert.notEqual(round.queue.at(-1)?.id, failedTask.id);

    const exactResume = await (await fetch(`${app.baseUrl}/api/study/rounds`, {
      method: "POST",
      headers: secondDevice,
      body: JSON.stringify({ wordbookId: book.id, mode: "new" }),
    })).json() as { round: StudyRound };
    assert.deepEqual(exactResume.round.queue, round.queue);

    const firstBeforeRotate = round.queue[0]!.wordId;
    round = await (await fetch(`${app.baseUrl}/api/study/rounds/${round.id}/rotate`, {
      method: "POST",
      headers: secondDevice,
      body: JSON.stringify({ revision: round.revision }),
    })).json() as StudyRound;
    assert.notEqual(round.queue[0]?.wordId, firstBeforeRotate);
    assert.equal(round.queue.at(-1)?.wordId, firstBeforeRotate);

    while (round.queue.length) {
      round = await (await fetch(`${app.baseUrl}/api/study/rounds/${round.id}/answers`, {
        method: "POST",
        headers: firstDevice,
        body: JSON.stringify({
          taskId: round.queue[0]!.id,
          response: "correct",
          operationId: randomUUID(),
          revision: round.revision,
        }),
      })).json() as StudyRound;
    }
    assert.equal(round.completedWordIds.length, 4);
    assert.ok(round.completedAt);

    const dashboard = await (await fetch(`${app.baseUrl}/api/study/dashboard/${book.id}`, { headers: secondDevice })).json() as {
      todayPlan: { new: { completed: number } };
      activeRounds: unknown[];
    };
    assert.equal(dashboard.todayPlan.new.completed, 4);
    assert.deepEqual(dashboard.activeRounds, []);
  } finally {
    await app.close();
  }
});

test("tiered review protects timely checkpoints and caps historical backlog", async () => {
  let now = new Date("2026-01-01T08:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => new Date(now) });
  const book = await store.createMyWordbook(CLIENT, {
    title: "Tiered review",
    words: [
      entry("archive"),
      entry("archaic"),
      entry("architect"),
      entry("recent"),
      entry("untouched"),
    ],
  });
  const words = await store.listWords(CLIENT, book.id);
  assert.ok(words);
  for (const word of words!.slice(0, 3)) {
    await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: word.id, verdict: "know" });
  }
  now = new Date("2026-01-18T08:00:00.000Z");
  await store.recordEvent(CLIENT, { kind: "new", wordbookId: book.id, wordId: words![3]!.id, verdict: "know" });
  await store.updateMyWordbook(CLIENT, book.id, {
    studyPreferences: {
      plan: { newWords: 0, dictation: 0, backlogReviews: 1 },
      modes: {
        new: { meaningPreference: "zh", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        review: { meaningPreference: "zh", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        dictation: {
          meaningPreference: "zh",
          showExamples: true,
          showPhonetic: false,
          autoPlayAudio: false,
          underlineMistakes: true,
          showMeaning: true,
          showCharacterMask: false,
        },
      },
    },
  });
  now = new Date("2026-01-20T08:00:00.000Z");

  const dashboard = await store.getDashboard(CLIENT, book.id);
  assert.deepEqual(dashboard?.reviewBreakdown, { protected: 1, regular: 0, backlog: 3, scheduled: 2 });
  assert.deepEqual(dashboard?.todayPlan.review, { target: 2, completed: 0 });

  const standard = await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review", scope: "standard" });
  assert.ok(standard);
  assert.deepEqual(standard!.round.wordIds, [words![3]!.id, words![0]!.id]);

  const cleanup = await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review", scope: "backlog" });
  assert.ok(cleanup);
  assert.deepEqual(cleanup!.round.wordIds, words!.slice(0, 3).map((word) => word.id));
});

test("completed daily new-word plans can open a separate ahead-learning batch", async () => {
  const store = new InMemoryStudyStore();
  const book = await store.createMyWordbook(CLIENT, {
    title: "Ahead learning",
    words: [entry("alpha"), entry("beta"), entry("gamma"), entry("delta")],
  });
  await store.updateMyWordbook(CLIENT, book.id, {
    studyPreferences: {
      plan: { newWords: 2, dictation: 0, backlogReviews: 0 },
      modes: {
        new: { meaningPreference: "en", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        review: { meaningPreference: "en", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        dictation: {
          meaningPreference: "en",
          showExamples: true,
          showPhonetic: false,
          autoPlayAudio: false,
          underlineMistakes: true,
          showMeaning: true,
          showCharacterMask: false,
        },
      },
    },
  });

  let standard = (await store.startStudyRound(CLIENT, {
    wordbookId: book.id,
    mode: "new",
    scope: "standard",
  }))!.round;
  assert.equal(standard.wordIds.length, 2);
  while (standard.queue.length) {
    const result = await store.answerStudyRound(CLIENT, standard.id, {
      taskId: standard.queue[0]!.id,
      response: "know",
      operationId: randomUUID(),
      revision: standard.revision,
    });
    assert.equal(result.kind, "updated");
    if (result.kind === "updated") standard = result.round;
  }
  assert.deepEqual((await store.getDashboard(CLIENT, book.id))?.todayPlan.new, {
    target: 2,
    completed: 2,
  });

  const ahead = await store.startStudyRound(CLIENT, {
    wordbookId: book.id,
    mode: "new",
    scope: "ahead",
  });
  assert.ok(ahead);
  assert.equal(ahead!.round.scope, "ahead");
  assert.equal(ahead!.round.wordIds.length, 2);
  assert.ok(ahead!.round.wordIds.every((wordId) => !standard.wordIds.includes(wordId)));
});

test("a vague judgment keeps the rung, shortens the checkpoint, and requeues the task", async () => {
  let now = new Date("2026-04-01T08:00:00.000Z");
  const store = new InMemoryStudyStore({ now: () => new Date(now) });
  const book = await store.createMyWordbook(CLIENT, { title: "Vague", words: [entry("ambiguous")] });
  const word = (await store.listWords(CLIENT, book.id))![0]!;
  await store.updateMyWordbook(CLIENT, book.id, {
    studyPreferences: {
      plan: { newWords: 1, dictation: 0, backlogReviews: 0 },
      modes: {
        new: { meaningPreference: "en", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        review: { meaningPreference: "en", showExamples: true, showPhonetic: true, autoPlayAudio: false, exerciseTypes: ["self-rating"] },
        dictation: {
          meaningPreference: "en",
          showExamples: true,
          showPhonetic: false,
          autoPlayAudio: false,
          underlineMistakes: true,
          showMeaning: true,
          showCharacterMask: false,
        },
      },
    },
  });
  let round = (await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "new" }))!.round;
  const originalTask = round.queue[0]!;
  const vague = await store.answerStudyRound(CLIENT, round.id, {
    taskId: originalTask.id,
    response: "vague",
    operationId: randomUUID(),
    revision: round.revision,
  });
  assert.equal(vague.kind, "updated");
  round = vague.kind === "updated" ? vague.round : round;
  assert.equal(round.queue.length, 1);
  assert.notEqual(round.queue[0]?.id, originalTask.id);
  assert.deepEqual(round.vagueWordIds, [word.id]);
  assert.equal((await store.listWords(CLIENT, book.id))![0]!.level, 0);

  const learned = await store.answerStudyRound(CLIENT, round.id, {
    taskId: round.queue[0]!.id,
    response: "know",
    operationId: randomUUID(),
    revision: round.revision,
  });
  assert.equal(learned.kind, "updated");
  assert.equal((await store.listWords(CLIENT, book.id))![0]!.level, 1);

  now = new Date("2026-04-02T08:00:00.000Z");
  let review = (await store.startStudyRound(CLIENT, { wordbookId: book.id, mode: "review" }))!.round;
  const reviewVague = await store.answerStudyRound(CLIENT, review.id, {
    taskId: review.queue[0]!.id,
    response: "vague",
    operationId: randomUUID(),
    revision: review.revision,
  });
  assert.equal(reviewVague.kind, "updated");
  review = reviewVague.kind === "updated" ? reviewVague.round : review;
  const afterVague = (await store.listWords(CLIENT, book.id))![0]!;
  assert.equal(afterVague.level, 1);
  assert.equal(afterVague.reviewIntervalDays, 1);
  assert.equal(afterVague.nextReviewAt, "2026-04-03T08:00:00.000Z");
  assert.equal(review.queue.length, 1);
});
