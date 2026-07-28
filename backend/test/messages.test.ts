import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { SqliteEngagementStore, type MessageActor } from "../src/engagement/store.js";

const directory = await mkdtemp(resolve(tmpdir(), "vacab-messages-"));
const file = resolve(directory, "messages.sqlite");
let now = new Date("2026-07-28T00:00:00.000Z");
const store = new SqliteEngagementStore(file, () => now);
after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

const alice: MessageActor = { clientId: "client-alice", userId: "user-alice", username: "Alice" };
const bob: MessageActor = { clientId: "client-bob", userId: "user-bob", username: "Bob" };

test("message board caps display depth, notifies reply recipients, and preserves ownership", async () => {
  const root = await store.createMessage(alice, { content: "root", contact: "alice@example.test" });
  assert.ok(root);
  const first = await store.createMessage(bob, { content: "first", parentId: root.id });
  assert.ok(first);
  const second = await store.createMessage(alice, { content: "second", parentId: first.id });
  assert.ok(second);
  const capped = await store.createMessage(bob, { content: "capped", parentId: second.id });
  assert.ok(capped);
  assert.equal(capped.depth, 2);
  assert.equal(capped.parentId, first.id);
  assert.equal(capped.replyTo, "Alice");
  assert.equal(await store.unreadMessageCount("user-alice"), 2);
  await store.markMessagesRead("user-alice");
  assert.equal(await store.unreadMessageCount("user-alice"), 0);
  const page = await store.listMessages(alice, undefined, 20);
  assert.equal(page.items.length, 4);
  assert.equal(page.items.find((item) => item.id === root.id)?.canDelete, true);
  assert.equal(page.items.find((item) => item.id === first.id)?.canDelete, false);
  assert.equal(page.items.find((item) => item.id === root.id)?.contact, undefined);
  const adminPage = await store.listMessages({ ...alice, isAdmin: true }, undefined, 20);
  assert.equal(adminPage.items.find((item) => item.id === root.id)?.contact, "alice@example.test");
});

test("editing expires after 30 minutes, soft deletion keeps the tree, and permanent deletion cascades logical replies", async () => {
  const root = (await store.listMessages(alice, undefined, 20)).items.find((item) => item.depth === 0)!;
  now = new Date("2026-07-28T00:20:00.000Z");
  const edited = await store.editMessage(alice, root.id, "edited root");
  assert.notEqual(edited, "forbidden");
  now = new Date("2026-07-28T00:31:00.000Z");
  assert.equal(await store.editMessage(alice, root.id, "too late"), "forbidden");
  assert.equal(await store.softDeleteMessage(alice, root.id), "deleted");
  assert.equal((await store.listMessages(alice, undefined, 20)).items[0]?.status, "deleted");
  assert.equal(await store.moderateMessage(root.id, "hide"), true);
  assert.equal(await store.permanentlyDeleteMessage(root.id), true);
  assert.equal((await store.listMessages(alice, undefined, 20)).items.length, 0);
});
