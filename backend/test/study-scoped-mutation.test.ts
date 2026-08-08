import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { BaseStore, EMPTY, type State } from "../src/study/store.js";

const CLIENT = "scoped-study-client";
const OTHER_CLIENT = "scoped-study-other";

class InspectableStore extends BaseStore {
  public data: State = EMPTY();
  public previous?: State;
  public saved?: State;

  constructor() {
    super();
  }

  protected async load(): Promise<State> {
    return this.data;
  }

  protected async save(state: State, previous?: State): Promise<void> {
    this.previous = previous;
    this.saved = state;
    this.data = state;
  }
}

function entry(word: string) {
  return {
    word,
    phonetic: "",
    source: "user" as const,
    meanings: [{ pos: "noun", definition: `${word} definition` }],
  };
}

function savedState(store: InspectableStore, previous: State): State {
  assert.equal(store.previous, previous);
  assert.ok(store.saved);
  return store.saved;
}

function assertRoundInternalsCopied(before: State, after: State, clientId: string, roundId: string): void {
  const beforeRound = before.clients[clientId]!.studyRounds.find((round) => round.id === roundId)!;
  const afterRound = after.clients[clientId]!.studyRounds.find((round) => round.id === roundId)!;
  assert.notEqual(afterRound, beforeRound);
  for (const key of [
    "exerciseTypes",
    "wordIds",
    "queue",
    "passedTaskKeys",
    "completedWordIds",
    "masteredWordIds",
    "vagueWordIds",
    "unknownWordIds",
    "processedOperationIds",
  ] as const) {
    assert.notEqual(afterRound[key], beforeRound[key], key);
  }
}

test("study hot paths copy only the target client's mutable state", async () => {
  const store = new InspectableStore();
  const created = await store.createMyWordbook(CLIENT, { title: "Scoped", words: [entry("alpha"), entry("gamma")] });
  await store.createMyWordbook(OTHER_CLIENT, { title: "Other", words: [entry("beta")] });
  const word = (await store.listWords(CLIENT, created.id))![0]!;

  const beforeStart = store.data;
  const started = await store.startStudyRound(CLIENT, { wordbookId: created.id, mode: "new" });
  assert.ok(started);
  const afterStart = savedState(store, beforeStart);
  assert.notEqual(afterStart, beforeStart);
  assert.notEqual(afterStart.clients, beforeStart.clients);
  assert.equal(afterStart.catalog, beforeStart.catalog);
  assert.equal(afterStart.revisions, beforeStart.revisions);
  assert.equal(afterStart.contributions, beforeStart.contributions);
  assert.equal(afterStart.users, beforeStart.users);
  assert.equal(afterStart.sessions, beforeStart.sessions);
  assert.equal(afterStart.clients[OTHER_CLIENT], beforeStart.clients[OTHER_CLIENT]);
  assert.notEqual(afterStart.clients[CLIENT], beforeStart.clients[CLIENT]);
  assert.equal(afterStart.clients[CLIENT]!.drafts, beforeStart.clients[CLIENT]!.drafts);
  assert.notEqual(afterStart.clients[CLIENT]!.wordbooks, beforeStart.clients[CLIENT]!.wordbooks);
  assert.notEqual(afterStart.clients[CLIENT]!.wordbooks[0], beforeStart.clients[CLIENT]!.wordbooks[0]);
  assert.equal(afterStart.clients[CLIENT]!.wordbooks[0]!.words, beforeStart.clients[CLIENT]!.wordbooks[0]!.words);
  assert.notEqual(afterStart.clients[CLIENT]!.studyRounds, beforeStart.clients[CLIENT]!.studyRounds);

  const roundId = started.round.id;
  const beforeRotate = afterStart;
  const rotated = await store.rotateStudyRound(CLIENT, roundId, started.round.revision);
  assert.equal(rotated.kind, "updated");
  const afterRotate = savedState(store, beforeRotate);
  assertRoundInternalsCopied(beforeRotate, afterRotate, CLIENT, roundId);
  assert.equal(afterRotate.clients[CLIENT]!.wordbooks[0]!.words, beforeRotate.clients[CLIENT]!.wordbooks[0]!.words);

  const beforeAnswer = afterRotate;
  const current = (await store.getStudyRound(CLIENT, roundId))!;
  const answered = await store.answerStudyRound(CLIENT, roundId, {
    taskId: current.queue[0]!.id,
    response: "know",
    operationId: randomUUID(),
    revision: current.revision,
  });
  assert.equal(answered.kind, "updated");
  const afterAnswer = savedState(store, beforeAnswer);
  assertRoundInternalsCopied(beforeAnswer, afterAnswer, CLIENT, roundId);
  assert.equal(afterAnswer.clients[CLIENT]!.wordbooks[0]!.words, beforeAnswer.clients[CLIENT]!.wordbooks[0]!.words);
  assert.notEqual(afterAnswer.clients[CLIENT]!.events, beforeAnswer.clients[CLIENT]!.events);

  const beforeEvent = afterAnswer;
  const recorded = await store.recordEvent(CLIENT, {
    kind: "flashcard",
    wordbookId: created.id,
    wordId: word.id,
    verdict: "know",
  });
  assert.ok(recorded);
  const afterEvent = savedState(store, beforeEvent);
  assert.notEqual(afterEvent.clients[CLIENT]!.events, beforeEvent.clients[CLIENT]!.events);
  assert.notEqual(afterEvent.clients[CLIENT]!.wordbooks[0], beforeEvent.clients[CLIENT]!.wordbooks[0]);
  assert.equal(afterEvent.clients[CLIENT]!.wordbooks[0]!.words, beforeEvent.clients[CLIENT]!.wordbooks[0]!.words);
  assert.equal(afterEvent.clients[CLIENT]!.drafts, beforeEvent.clients[CLIENT]!.drafts);
  assert.equal(afterEvent.clients[OTHER_CLIENT], beforeEvent.clients[OTHER_CLIENT]);

  const beforeWordEdit = afterEvent;
  const beforeWords = beforeWordEdit.clients[CLIENT]!.wordbooks[0]!.words;
  const targetIndex = beforeWords.findIndex((candidate) => candidate.id === word.id);
  const unrelatedIndex = targetIndex === 0 ? 1 : 0;
  const updated = await store.updateWord(CLIENT, created.id, word.id, { phonetic: "/updated/" });
  assert.equal(updated.kind, "updated");
  const afterWordEdit = savedState(store, beforeWordEdit);
  const afterWords = afterWordEdit.clients[CLIENT]!.wordbooks[0]!.words;
  assert.notEqual(afterWords, beforeWords);
  assert.notEqual(afterWords[targetIndex], beforeWords[targetIndex]);
  assert.equal(afterWords[unrelatedIndex], beforeWords[unrelatedIndex]);
  assert.equal(afterWordEdit.clients[CLIENT]!.drafts, beforeWordEdit.clients[CLIENT]!.drafts);
  assert.equal(afterWordEdit.clients[OTHER_CLIENT], beforeWordEdit.clients[OTHER_CLIENT]);
});
