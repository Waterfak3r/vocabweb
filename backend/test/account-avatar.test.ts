import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ACCOUNT_AVATAR_MAX_BYTES } from "../src/account-avatar.js";
import { createApp } from "../src/app.js";
import { InMemoryStudyStore, JsonFileStudyStore } from "../src/study/store.js";

const ALICE_CLIENT = "avatar-alice-0001";
const BOB_CLIENT = "avatar-bob-000001";

const avatarFixtures = [
  { mimeType: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]) },
  { mimeType: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) },
  { mimeType: "image/webp", bytes: Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ", "binary") },
] as const;

async function fixture(productionSecurity = false) {
  const store = new InMemoryStudyStore();
  const server: Server = createApp({ studyStore: store, productionSecurity }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function register(baseUrl: string, clientId: string, username: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vocab-client-id": clientId },
    body: JSON.stringify({ username, password: "password-123" }),
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function upload(baseUrl: string, cookie: string, mimeType: string, bytes: Buffer, origin?: string) {
  return await fetch(`${baseUrl}/api/account/avatar`, {
    method: "PUT",
    headers: {
      cookie,
      "content-type": mimeType,
      ...(origin ? { origin, "sec-fetch-site": "same-origin" } : {}),
    },
    body: new Uint8Array(bytes),
  });
}

test("account avatars validate, replace, isolate, export, cache, and delete", async () => {
  const app = await fixture();
  try {
    const aliceCookie = await register(app.baseUrl, ALICE_CLIENT, "AvatarAlice");
    const bobCookie = await register(app.baseUrl, BOB_CLIENT, "AvatarBob");

    const anonymous = await upload(app.baseUrl, "", "image/png", avatarFixtures[1].bytes);
    assert.equal(anonymous.status, 401);

    let previousUrl: string | null = null;
    for (const avatar of avatarFixtures) {
      const response = await upload(app.baseUrl, aliceCookie, avatar.mimeType, avatar.bytes);
      assert.equal(response.status, 200);
      const dto = await response.json() as Record<string, unknown>;
      assert.equal(dto.avatarUrl && typeof dto.avatarUrl === "string", true);
      assert.equal("dataBase64" in dto, false);
      const avatarUrl = dto.avatarUrl as string;
      assert.match(avatarUrl, /^\/api\/account\/avatar\/[A-Za-z0-9-]{8,128}$/);
      assert.notEqual(avatarUrl, previousUrl);

      if (previousUrl) {
        assert.equal((await fetch(`${app.baseUrl}${previousUrl}`, { headers: { cookie: aliceCookie } })).status, 404);
      }
      assert.equal((await fetch(`${app.baseUrl}${avatarUrl}`, { headers: { cookie: bobCookie } })).status, 404);

      const image = await fetch(`${app.baseUrl}${avatarUrl}`, { headers: { cookie: aliceCookie } });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), avatar.mimeType);
      assert.equal(image.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.match(image.headers.get("vary") ?? "", /(?:^|,\s*)Cookie(?:,|$)/);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), avatar.bytes);
      previousUrl = avatarUrl;
    }

    const me = await (await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie: aliceCookie } })).json() as { avatarUrl: string };
    assert.equal(me.avatarUrl, previousUrl);
    const exported = await (await fetch(`${app.baseUrl}/api/account/export`, { headers: { cookie: aliceCookie } })).json() as {
      study: { account: { avatar: { mimeType: string; dataBase64: string } } };
    };
    assert.equal(exported.study.account.avatar.mimeType, avatarFixtures[2].mimeType);
    assert.equal(exported.study.account.avatar.dataBase64, avatarFixtures[2].bytes.toString("base64"));

    const removed = await fetch(`${app.baseUrl}/api/account/avatar`, { method: "DELETE", headers: { cookie: aliceCookie } });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json() as { avatarUrl: unknown }).avatarUrl, null);
    assert.equal((await fetch(`${app.baseUrl}${previousUrl}`, { headers: { cookie: aliceCookie } })).status, 404);
    assert.equal((await app.store.getUserAvatar((await app.store.getUserByUsername("AvatarAlice"))!.id)), null);
  } finally {
    await app.close();
  }
});

test("public avatar versions are readable without a session and hide stale versions", async () => {
  const app = await fixture();
  try {
    const cookie = await register(app.baseUrl, ALICE_CLIENT, "PublicAvatar");
    const uploaded = await upload(app.baseUrl, cookie, "image/png", avatarFixtures[1].bytes);
    assert.equal(uploaded.status, 200);
    const privateUrl = (await uploaded.json() as { avatarUrl: string }).avatarUrl;
    const version = privateUrl.split("/").at(-1)!;
    const publicUrl = `/api/avatars/${version}`;

    const anonymous = await fetch(`${app.baseUrl}${publicUrl}`);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.headers.get("content-type"), "image/png");
    assert.equal(anonymous.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.deepEqual(Buffer.from(await anonymous.arrayBuffer()), avatarFixtures[1].bytes);

    const posted = await fetch(`${app.baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-vocab-client-id": ALICE_CLIENT,
      },
      body: JSON.stringify({ content: "带上头像的留言" }),
    });
    assert.equal(posted.status, 201);
    assert.equal((await posted.json() as { avatarUrl: string | null }).avatarUrl, publicUrl);

    const replaced = await upload(app.baseUrl, cookie, "image/jpeg", avatarFixtures[0].bytes);
    assert.equal(replaced.status, 200);
    assert.equal((await fetch(`${app.baseUrl}${publicUrl}`)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/avatars/not-a-version`)).status, 404);
  } finally {
    await app.close();
  }
});

test("account avatar uploads expose stable MIME, image, size, and encoding errors", async () => {
  const app = await fixture();
  try {
    const cookie = await register(app.baseUrl, ALICE_CLIENT, "AvatarLimits");
    const unsupported = await upload(app.baseUrl, cookie, "image/gif", Buffer.from("GIF89a"));
    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json() as { error: { code: string } }).error.code, "UNSUPPORTED_AVATAR_TYPE");

    const empty = await upload(app.baseUrl, cookie, "image/png", Buffer.alloc(0));
    assert.equal(empty.status, 400);
    assert.equal((await empty.json() as { error: { code: string } }).error.code, "INVALID_AVATAR_IMAGE");

    const mismatch = await upload(app.baseUrl, cookie, "image/jpeg", avatarFixtures[1].bytes);
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json() as { error: { code: string } }).error.code, "INVALID_AVATAR_IMAGE");

    const exactLimit = Buffer.alloc(ACCOUNT_AVATAR_MAX_BYTES);
    avatarFixtures[1].bytes.copy(exactLimit);
    assert.equal((await upload(app.baseUrl, cookie, "image/png", exactLimit)).status, 200);

    const oversized = Buffer.alloc(ACCOUNT_AVATAR_MAX_BYTES + 1);
    avatarFixtures[1].bytes.copy(oversized);
    const tooLarge = await upload(app.baseUrl, cookie, "image/png", oversized);
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json() as { error: { code: string } }).error.code, "AVATAR_TOO_LARGE");

    const mislabeledTooLarge = await upload(app.baseUrl, cookie, "application/json", oversized);
    assert.equal(mislabeledTooLarge.status, 413);
    assert.equal((await mislabeledTooLarge.json() as { error: { code: string } }).error.code, "AVATAR_TOO_LARGE");

    const compressed = await fetch(`${app.baseUrl}/api/account/avatar`, {
      method: "PUT",
      headers: { cookie, "content-type": "image/png", "content-encoding": "gzip" },
      body: new Uint8Array(avatarFixtures[1].bytes),
    });
    assert.equal(compressed.status, 415);
    assert.equal((await compressed.json() as { error: { code: string } }).error.code, "UNSUPPORTED_AVATAR_ENCODING");

    const malformedVersion = await fetch(`${app.baseUrl}/api/account/avatar/%FF`, { headers: { cookie } });
    assert.equal(malformedVersion.status, 404);
    assert.equal((await malformedVersion.json() as { error: { code: string } }).error.code, "AVATAR_NOT_FOUND");
  } finally {
    await app.close();
  }
});

test("production avatar mutations require same-origin evidence", async () => {
  const app = await fixture(true);
  try {
    const cookie = await register(app.baseUrl, ALICE_CLIENT, "AvatarCsrf");
    assert.equal((await upload(app.baseUrl, cookie, "image/png", avatarFixtures[1].bytes)).status, 403);
    assert.equal((await upload(app.baseUrl, cookie, "image/png", avatarFixtures[1].bytes, app.baseUrl)).status, 200);
  } finally {
    await app.close();
  }
});

test("JSON storage reloads account avatars and their lightweight metadata", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "vacab-avatar-json-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, "study-state.json");
  const first = new JsonFileStudyStore(file);
  const created = await first.createUser("JsonAvatar", "hash", ALICE_CLIENT);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") return;
  await assert.rejects(
    first.setUserAvatar(created.user.id, { mimeType: "image/png", dataBase64: Buffer.from("not an image").toString("base64") }),
    /avatar payload is invalid/i,
  );
  assert.equal(await first.getUserAvatar(created.user.id), null);
  const updated = await first.setUserAvatar(created.user.id, {
    mimeType: "image/png",
    dataBase64: avatarFixtures[1].bytes.toString("base64"),
  });
  assert.ok(updated?.avatarVersion);

  const reopened = new JsonFileStudyStore(file);
  assert.equal((await reopened.getUserById(created.user.id))?.avatarVersion, updated?.avatarVersion);
  assert.equal((await reopened.getUserAvatar(created.user.id))?.dataBase64, avatarFixtures[1].bytes.toString("base64"));
});
