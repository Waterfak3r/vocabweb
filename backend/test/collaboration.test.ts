import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogDiffStats,
  diffCatalogWords,
  inverseRevisionAgainstHead,
  sameCatalogWord,
  threeWayContribution,
} from "../src/study/collaboration.js";
import { migrate } from "../src/study/ladder.js";
import { InMemoryStudyStore } from "../src/study/store.js";
import type { CatalogAuthor, StudyWordEntry } from "../src/study/types.js";

const PUBLISHER_CLIENT = "publisher-client-1234";
const CONTRIBUTOR_CLIENT = "contributor-client-1";

const entry = (word: string, zhMeaning: string): StudyWordEntry => ({
  word,
  phonetic: `/${word}/`,
  meanings: [{ pos: "noun", definition: `${word} definition` }],
  source: "user",
  zhMeaning,
  zhMeaningSource: "user",
});

function clock() {
  let value = Date.parse("2026-01-01T00:00:00.000Z");
  return () => new Date(value += 1_000);
}

async function collaborationFixture() {
  const store = new InMemoryStudyStore({ now: clock() });
  const publisherResult = await store.createUser("Publisher", "hash", PUBLISHER_CLIENT);
  const contributorResult = await store.createUser("Contributor", "hash", CONTRIBUTOR_CLIENT);
  assert.equal(publisherResult.kind, "created");
  assert.equal(contributorResult.kind, "created");
  if (publisherResult.kind !== "created" || contributorResult.kind !== "created") throw new Error("fixture failed");
  const publisher: CatalogAuthor = { userId: publisherResult.user.id, username: publisherResult.user.username };
  const contributor: CatalogAuthor = { userId: contributorResult.user.id, username: contributorResult.user.username };
  const source = await store.createMyWordbook(PUBLISHER_CLIENT, {
    title: "Shared",
    words: [entry("alpha", "甲"), entry("beta", "乙")],
  });
  const sourceWords = await store.listWords(PUBLISHER_CLIENT, source.id);
  assert.ok(sourceWords);
  await store.recordEvent(PUBLISHER_CLIENT, {
    kind: "flashcard",
    wordbookId: source.id,
    wordId: sourceWords[0]!.id,
    verdict: "know",
  });
  const catalog = await store.uploadCatalog(PUBLISHER_CLIENT, {
    sourceWordbookId: source.id,
    visibility: "public",
    author: publisher,
  });
  assert.ok(catalog);
  const joined = await store.addCatalogToMine(CONTRIBUTOR_CLIENT, catalog.id);
  assert.ok(joined);
  return { store, publisher, contributor, source, catalog, joined: joined.wordbook, originalAlphaId: sourceWords[0]!.id };
}

test("word diffs are canonical, treat renames as delete plus add, and compute three-way intent", () => {
  const before = [entry("alpha", "甲"), entry("rename-me", "旧")];
  const personal = [entry("alpha", "新甲"), entry("renamed", "新")];
  const head = [entry("alpha", "甲"), entry("rename-me", "旧"), entry("server-only", "服务端")];
  const threeWay = threeWayContribution(before, personal, head);
  assert.deepEqual(threeWay.changes.map((change) => [change.kind, change.key]), [
    ["update", "alpha"],
    ["delete", "rename-me"],
    ["add", "renamed"],
  ]);
  assert.equal(threeWay.overlaps.length, 0);
  assert.deepEqual(catalogDiffStats(threeWay.changes), {
    additions: 1,
    deletions: 1,
    updates: 1,
    changedWords: 3,
  });
});

test("word diffs ignore internal dictionary provenance metadata", () => {
  const before = entry("alpha", "甲");
  const imported: StudyWordEntry = {
    ...before,
    source: "backend",
    zhMeaningSource: "dictionary",
  };

  assert.equal(sameCatalogWord(before, imported), true);
  assert.deepEqual(diffCatalogWords([before], [imported]), []);
  assert.deepEqual(threeWayContribution([before], [imported], [before]), {
    changes: [],
    overlaps: [],
  });

  const meaningful = diffCatalogWords([before], [{ ...imported, zhMeaning: "新的甲" }]);
  assert.deepEqual(meaningful.map((change) => [change.kind, change.key]), [["update", "alpha"]]);
  assert.deepEqual(catalogDiffStats([
    { kind: "update", key: "alpha", before, after: imported },
  ]), { additions: 0, deletions: 0, updates: 0, changedWords: 0 });
});

test("a full contribution merge preserves same-spelling progress and revert creates an inverse version", async () => {
  const { store, publisher, contributor, source, catalog, joined, originalAlphaId } = await collaborationFixture();
  const contributorWords = await store.listWords(CONTRIBUTOR_CLIENT, joined.id);
  assert.ok(contributorWords);
  const alpha = contributorWords.find((word) => word.word === "alpha")!;
  const beta = contributorWords.find((word) => word.word === "beta")!;
  await store.updateWord(CONTRIBUTOR_CLIENT, joined.id, alpha.id, { zhMeaning: "改进后的甲" });
  await store.batchWords(CONTRIBUTOR_CLIENT, joined.id, { action: "delete", wordIds: [beta.id] });
  await store.addWordToMyWordbook(CONTRIBUTOR_CLIENT, joined.id, entry("gamma", "丙"));

  const publisherWordsBeforeMerge = await store.listWords(PUBLISHER_CLIENT, source.id);
  const publisherBeta = publisherWordsBeforeMerge?.find((word) => word.word === "beta");
  assert.ok(publisherBeta);
  await store.recordEvent(PUBLISHER_CLIENT, {
    kind: "flashcard",
    wordbookId: source.id,
    wordId: publisherBeta.id,
    verdict: "know",
  });

  const preview = await store.getContributionPreview(CONTRIBUTOR_CLIENT, contributor.userId, joined.id);
  assert.ok(preview);
  assert.deepEqual(preview.changes.map((change) => [change.kind, change.key]), [
    ["update", "alpha"],
    ["delete", "beta"],
    ["add", "gamma"],
  ]);
  const created = await store.createContribution(CONTRIBUTOR_CLIENT, contributor, catalog.id, {
    title: "完善三个词条",
    description: "更新、删除并补充词条",
    expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
    expectedHeadRevisionId: preview.expectedHeadRevisionId,
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("contribution was not created");

  const merged = await store.mergeContribution(PUBLISHER_CLIENT, publisher, catalog.id, created.contribution.id, {});
  assert.equal(merged.kind, "updated");
  const publicAfterMerge = await store.getCatalog(PUBLISHER_CLIENT, catalog.id);
  assert.deepEqual(publicAfterMerge?.words.map((word) => [word.word, word.zhMeaning]), [
    ["alpha", "改进后的甲"],
    ["gamma", "丙"],
  ]);
  const publisherAfterMerge = await store.listWords(PUBLISHER_CLIENT, source.id);
  assert.equal(publisherAfterMerge?.find((word) => word.word === "alpha")?.id, originalAlphaId);
  assert.equal(publisherAfterMerge?.find((word) => word.word === "alpha")?.level, 1);
  assert.equal(publisherAfterMerge?.some((word) => word.word === "beta"), false);
  assert.equal((await store.getDashboard(PUBLISHER_CLIENT, source.id))?.recentActivity.some(
    (event) => event.word === "beta",
  ), true);

  const publisherGamma = publisherAfterMerge?.find((word) => word.word === "gamma");
  assert.ok(publisherGamma);
  await store.recordEvent(PUBLISHER_CLIENT, {
    kind: "new",
    wordbookId: source.id,
    wordId: publisherGamma.id,
    verdict: "know",
  });

  const revisions = await store.listCatalogRevisions(PUBLISHER_CLIENT, publisher.userId, catalog.id, {});
  assert.ok(revisions);
  const mergeRevision = revisions.items.find((revision) => revision.kind === "merge");
  assert.ok(mergeRevision);
  const revertPreview = await store.getRevertPreview(PUBLISHER_CLIENT, publisher.userId, catalog.id, mergeRevision.id);
  assert.ok(revertPreview);
  assert.deepEqual(revertPreview.changes.map((change) => [change.kind, change.key]), [
    ["update", "alpha"],
    ["add", "beta"],
    ["delete", "gamma"],
  ]);
  const reverted = await store.revertRevision(PUBLISHER_CLIENT, publisher, catalog.id, mergeRevision.id, {
    expectedHeadRevisionId: revertPreview.headRevisionId,
  });
  assert.equal(reverted.kind, "updated");
  if (reverted.kind !== "updated") throw new Error("revision was not reverted");
  const publicAfterRevert = await store.getCatalog(PUBLISHER_CLIENT, catalog.id);
  assert.deepEqual(publicAfterRevert?.words.map((word) => [word.word, word.zhMeaning]), [
    ["alpha", "甲"],
    ["beta", "乙"],
  ]);
  assert.equal((await store.getDashboard(PUBLISHER_CLIENT, source.id))?.recentActivity.some(
    (event) => event.word === "gamma",
  ), true);

  const already = await store.revertRevision(PUBLISHER_CLIENT, publisher, catalog.id, mergeRevision.id, {
    expectedHeadRevisionId: reverted.revision.id,
  });
  assert.equal(already.kind, "already-reverted");
  const revertTheRevert = await store.revertRevision(PUBLISHER_CLIENT, publisher, catalog.id, reverted.revision.id, {
    expectedHeadRevisionId: reverted.revision.id,
  });
  assert.equal(revertTheRevert.kind, "updated");
});

test("three-way preview keeps unrelated publisher changes and merge rejects later overlap atomically", async () => {
  const { store, publisher, contributor, source, catalog, joined } = await collaborationFixture();
  const contributorWords = await store.listWords(CONTRIBUTOR_CLIENT, joined.id);
  const alpha = contributorWords!.find((word) => word.word === "alpha")!;
  await store.updateWord(CONTRIBUTOR_CLIENT, joined.id, alpha.id, { zhMeaning: "贡献者甲" });

  const publisherWords = await store.listWords(PUBLISHER_CLIENT, source.id);
  const beta = publisherWords!.find((word) => word.word === "beta")!;
  await store.updateWord(PUBLISHER_CLIENT, source.id, beta.id, { zhMeaning: "发布者乙" });
  const betaSnapshot = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    expectedHeadRevisionId: catalog.headRevisionId,
    message: "更新 beta",
    author: publisher,
  });
  assert.equal(betaSnapshot.kind, "updated");
  if (betaSnapshot.kind !== "updated") throw new Error("snapshot was not updated");

  const preview = await store.getContributionPreview(CONTRIBUTOR_CLIENT, contributor.userId, joined.id);
  assert.ok(preview);
  assert.deepEqual(preview.changes.map((change) => change.key), ["alpha"]);
  assert.equal(preview.overlaps.length, 0);
  const created = await store.createContribution(CONTRIBUTOR_CLIENT, contributor, catalog.id, {
    title: "改进 alpha",
    expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
    expectedHeadRevisionId: preview.expectedHeadRevisionId,
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("contribution was not created");

  const latestPublisherWords = await store.listWords(PUBLISHER_CLIENT, source.id);
  const publisherAlpha = latestPublisherWords!.find((word) => word.word === "alpha")!;
  await store.updateWord(PUBLISHER_CLIENT, source.id, publisherAlpha.id, { zhMeaning: "发布者后来修改" });
  await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    expectedHeadRevisionId: betaSnapshot.catalog.headRevisionId,
    message: "抢先修改 alpha",
    author: publisher,
  });
  const publicBeforeMerge = await store.getCatalog(PUBLISHER_CLIENT, catalog.id);
  const conflict = await store.mergeContribution(PUBLISHER_CLIENT, publisher, catalog.id, created.contribution.id, {});
  assert.equal(conflict.kind, "conflict");
  const publicAfterConflict = await store.getCatalog(PUBLISHER_CLIENT, catalog.id);
  assert.deepEqual(publicAfterConflict?.words, publicBeforeMerge?.words);
});

test("publisher source divergence blocks merge without changing the public head", async () => {
  const { store, publisher, contributor, source, catalog, joined } = await collaborationFixture();
  const contributorWords = await store.listWords(CONTRIBUTOR_CLIENT, joined.id);
  const alpha = contributorWords!.find((word) => word.word === "alpha")!;
  await store.updateWord(CONTRIBUTOR_CLIENT, joined.id, alpha.id, { zhMeaning: "贡献者甲" });
  const preview = await store.getContributionPreview(CONTRIBUTOR_CLIENT, contributor.userId, joined.id);
  assert.ok(preview);
  const created = await store.createContribution(CONTRIBUTOR_CLIENT, contributor, catalog.id, {
    title: "改进 alpha",
    expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
    expectedHeadRevisionId: preview.expectedHeadRevisionId,
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("contribution was not created");

  const publisherWords = await store.listWords(PUBLISHER_CLIENT, source.id);
  const publisherAlpha = publisherWords!.find((word) => word.word === "alpha")!;
  await store.updateWord(PUBLISHER_CLIENT, source.id, publisherAlpha.id, { zhMeaning: "尚未发布的修改" });
  const headBefore = (await store.getCatalog(PUBLISHER_CLIENT, catalog.id))!.headRevisionId;
  const result = await store.mergeContribution(PUBLISHER_CLIENT, publisher, catalog.id, created.contribution.id, {});
  assert.equal(result.kind, "conflict");
  assert.equal((await store.getCatalog(PUBLISHER_CLIENT, catalog.id))!.headRevisionId, headBefore);
});

test("snapshot updates require the current head, keep the linked source, and skip empty versions", async () => {
  const { store, publisher, contributor, source, catalog, joined } = await collaborationFixture();

  const missingHead = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    author: publisher,
  });
  assert.deepEqual(missingHead, { kind: "head-required", headRevisionId: catalog.headRevisionId });

  const stale = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    expectedHeadRevisionId: "revision-stale-preview",
    author: publisher,
  });
  assert.deepEqual(stale, { kind: "stale", headRevisionId: catalog.headRevisionId });

  const noOp = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    expectedHeadRevisionId: catalog.headRevisionId,
    message: "没有实际变化",
    author: publisher,
  });
  assert.equal(noOp.kind, "updated");
  if (noOp.kind !== "updated") throw new Error("no-op snapshot was rejected");
  assert.equal(noOp.catalog.headRevisionId, catalog.headRevisionId);
  const initialHistory = await store.listCatalogRevisions(PUBLISHER_CLIENT, publisher.userId, catalog.id, {});
  assert.deepEqual(initialHistory?.items.map((revision) => revision.kind), ["initial"]);

  const alternate = await store.createMyWordbook(PUBLISHER_CLIENT, {
    title: "Wrong source",
    words: [entry("alpha", "另一个来源")],
  });
  const switched = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: alternate.id,
    expectedHeadRevisionId: catalog.headRevisionId,
    author: publisher,
  });
  assert.deepEqual(switched, {
    kind: "source-mismatch",
    headRevisionId: catalog.headRevisionId,
    sourceWordbookId: source.id,
  });

  const contributorWords = await store.listWords(CONTRIBUTOR_CLIENT, joined.id);
  const alpha = contributorWords!.find((word) => word.word === "alpha")!;
  await store.updateWord(CONTRIBUTOR_CLIENT, joined.id, alpha.id, { zhMeaning: "合并后的甲" });
  const preview = await store.getContributionPreview(CONTRIBUTOR_CLIENT, contributor.userId, joined.id);
  assert.ok(preview);
  const created = await store.createContribution(CONTRIBUTOR_CLIENT, contributor, catalog.id, {
    title: "提交 alpha 改进",
    expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
    expectedHeadRevisionId: preview.expectedHeadRevisionId,
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("contribution was not created");
  assert.equal((await store.mergeContribution(PUBLISHER_CLIENT, publisher, catalog.id, created.contribution.id, {})).kind, "updated");

  const merged = await store.getCatalog(PUBLISHER_CLIENT, catalog.id);
  assert.ok(merged);
  const afterMergeSnapshot = await store.updateCatalog(PUBLISHER_CLIENT, catalog.id, {
    sourceWordbookId: source.id,
    expectedHeadRevisionId: merged.headRevisionId,
    message: "合并后刷新同一来源",
    author: publisher,
  });
  assert.equal(afterMergeSnapshot.kind, "updated");
  if (afterMergeSnapshot.kind !== "updated") throw new Error("same-source snapshot was rejected");
  assert.equal(afterMergeSnapshot.catalog.headRevisionId, merged.headRevisionId);
  assert.equal((await store.getCatalog(PUBLISHER_CLIENT, catalog.id))?.words.find((word) => word.word === "alpha")?.zhMeaning, "合并后的甲");
  const finalHistory = await store.listCatalogRevisions(PUBLISHER_CLIENT, publisher.userId, catalog.id, {});
  assert.deepEqual(finalHistory?.items.map((revision) => revision.kind), ["merge", "initial"]);
});

test("v5 migration creates one deterministic immutable initial revision per catalog", () => {
  const legacyBook = {
    id: "catalog-legacy",
    title: "Legacy",
    description: "",
    author: "匿名",
    exams: [],
    goals: [],
    rating: 0,
    uses: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    shareCode: "ABCDEF12",
    words: [entry("alpha", "甲")],
    visibility: "public",
  };
  const migrated = migrate({
    version: 5,
    catalog: [legacyBook],
    clients: {},
    users: [],
    sessions: [],
  });
  assert.equal(migrated.version, 6);
  assert.equal(migrated.revisions.length, 1);
  assert.equal(migrated.catalog[0]!.headRevisionId, migrated.revisions[0]!.id);
  assert.equal(migrated.catalog[0]!.updatedAt, legacyBook.createdAt);
  assert.deepEqual(migrated.revisions[0]!.changes.map((change) => [change.kind, change.key]), [["add", "alpha"]]);
  const migratedAgain = migrate(migrated);
  assert.equal(migratedAgain.revisions.length, 1);
  assert.equal(migratedAgain.catalog[0]!.headRevisionId, migrated.revisions[0]!.id);
});

test("inverse revision reports later edits as conflicts", () => {
  const before = [entry("alpha", "甲")];
  const after = [entry("alpha", "新甲")];
  const changes = diffCatalogWords(before, after);
  const result = inverseRevisionAgainstHead({
    id: "revision-test",
    catalogId: "catalog-test",
    kind: "update",
    message: "update",
    author: "A",
    createdAt: "2026-01-01T00:00:00.000Z",
    changes,
    stats: catalogDiffStats(changes),
  }, [entry("alpha", "后续修改")]);
  assert.equal(result.changes.length, 0);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.key), ["alpha"]);
});
