#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const clientIdKey = "vocab-ielts:client-id:v1";
const username = `验收用户_${Date.now().toString(36)}`;
const password = "E2e-pass-2026!";
const sourceTitle = `匿名验收词本-${Date.now().toString(36)}`;
const titles = {
  public: `${sourceTitle}-公开`,
  unlisted: `${sourceTitle}-邀请码`,
  private: `${sourceTitle}-私密`,
};

function step(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function findChrome() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) {
    throw new Error("未找到系统 Chrome；请通过 PLAYWRIGHT_CHROME_PATH 指定可执行文件。");
  }
  return executable;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`生产服务提前退出 (${child.exitCode})\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The port is not accepting connections yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`等待生产服务超时\n${logs.join("")}`);
}

function watchPage(page, label, errors) {
  page.on("pageerror", (error) => errors.push(`[${label}] pageerror: ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Chromium reports expected HTTP authorization/missing-resource responses as
    // console errors even when application code handles them. This flow
    // deliberately exercises anonymous /auth/me (401) and a rejected private
    // share code (404); every other console error remains fatal.
    if (/^Failed to load resource: the server responded with a status of (401|404) \(/.test(text)) return;
    errors.push(`[${label}] console.error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    // Successful logout immediately reloads the document, so Chromium may mark
    // the already-handled 204 fetch as aborted during navigation.
    if (request.url().endsWith("/api/auth/logout") && request.failure()?.errorText === "net::ERR_ABORTED") return;
    errors.push(`[${label}] requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
}

async function api(page, path, init = {}) {
  const result = await page.evaluate(async ({ path, init, clientIdKey }) => {
    let clientId = localStorage.getItem(clientIdKey);
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem(clientIdKey, clientId);
    }
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Vocab-Client-Id": clientId,
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { ok: response.ok, status: response.status, body };
  }, { path, init, clientIdKey });
  if (!result.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function publish(page, visibility, title) {
  await page.getByRole("button", { name: "上传我的词库" }).click();
  const dialog = page.getByRole("dialog", { name: "发布我的词本" });
  await dialog.waitFor();
  await dialog.getByLabel("社区展示名称").fill(title);
  await dialog.locator(`input[name="publish-visibility"][value="${visibility}"]`).check();
  await dialog.getByRole("button", { name: "预览发布" }).click();
  const preview = page.getByRole("dialog", { name: "确认社区快照" });
  await preview.getByText(`可见性：${visibility === "public" ? "公开" : visibility === "unlisted" ? "邀请码" : "私密"}`).waitFor();
  await preview.getByRole("button", { name: "确认发布" }).click();
  await page.getByRole("status").filter({ hasText: `「${title}」已作为独立快照发布` }).waitFor();
}

async function openAuth(page, action) {
  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  return page.getByRole("dialog", { name: action });
}

async function signIn(page) {
  const dialog = await openAuth(page, "登录");
  await dialog.getByLabel("用户名").fill(username);
  await dialog.getByLabel("密码").fill(password);
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "账号" }).click();
  await page.getByText(username, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
}

async function main() {
  const frontendBuild = resolve(repoRoot, "frontend", "dist", "index.html");
  const backendBuild = resolve(repoRoot, "backend", "dist", "server.js");
  assert(existsSync(frontendBuild) && existsSync(backendBuild), "缺少构建产物；请先运行 npm run build");

  const tempDir = await mkdtemp(join(tmpdir(), "vacabweb-e2e-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverLogs = [];
  const server = spawn(process.execPath, ["scripts/start-prod.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_FILE: join(tempDir, "study-state.sqlite"),
      DATA_FILE: join(tempDir, "legacy-study-state.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));

  let browser;
  const browserErrors = [];
  try {
    await waitForServer(baseUrl, server, serverLogs);
    step(`临时生产服务已启动 (${baseUrl})`);

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ["--disable-background-networking"],
    });
    const ownerContext = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN" });
    const owner = await ownerContext.newPage();
    watchPage(owner, "账号浏览器", browserErrors);
    await owner.goto("/");
    await owner.getByRole("heading", { level: 1 }).waitFor();

    const created = await api(owner, "/api/my/wordbooks", {
      method: "POST",
      body: JSON.stringify({
        title: sourceTitle,
        description: "浏览器验收创建的匿名数据",
        words: [{
          word: "resilient",
          phonetic: "/rɪˈzɪliənt/",
          meanings: [{ pos: "adjective", definition: "able to recover quickly" }],
          source: "user",
          zhMeaning: "有韧性的",
          zhMeaningSource: "user",
        }],
      }),
    });
    assert.equal(created.title, sourceTitle);
    step("匿名数据空间已创建非空词本");

    const register = await openAuth(owner, "注册");
    await register.getByLabel("用户名").fill(username);
    await register.getByLabel("密码").fill(password);
    await register.getByRole("button", { name: "注册", exact: true }).click();
    await owner.getByRole("button", { name: "账号" }).click();
    await owner.getByText(username, { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    const afterRegister = await api(owner, "/api/my/wordbooks");
    assert(afterRegister.some((book) => book.title === sourceTitle), "注册后匿名词本丢失");
    await owner.goto("/wordbook");
    await owner.getByText(sourceTitle, { exact: true }).first().waitFor();
    step("注册成功，匿名词本完整保留");

    await owner.goto("/marketplace");
    await owner.getByRole("heading", { name: "共享单词本广场" }).waitFor();
    await publish(owner, "public", titles.public);
    await publish(owner, "unlisted", titles.unlisted);
    await publish(owner, "private", titles.private);
    const uploads = await api(owner, "/api/catalog/uploads/mine");
    for (const visibility of ["public", "unlisted", "private"]) {
      assert(uploads.some((book) => book.title === titles[visibility] && book.visibility === visibility));
    }
    const unlisted = uploads.find((book) => book.title === titles.unlisted);
    const privateUpload = uploads.find((book) => book.title === titles.private);
    assert.match(unlisted?.shareCode ?? "", /^[A-Z0-9]{24}$/);
    assert.match(privateUpload?.shareCode ?? "", /^[A-Z0-9]{24}$/);
    step("三档可见性均通过页面发布并保存正确");

    const guestContext = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN" });
    const guest = await guestContext.newPage();
    watchPage(guest, "匿名导入浏览器", browserErrors);
    await guest.goto("/marketplace");
    await guest.getByRole("heading", { name: "共享单词本广场" }).waitFor();
    const guestCatalog = await api(guest, "/api/catalog/wordbooks");
    assert(guestCatalog.some((book) => book.title === titles.public), "公开词本未出现在匿名广场");
    assert(!guestCatalog.some((book) => book.title === titles.unlisted), "邀请码词本泄漏到匿名广场");
    assert(!guestCatalog.some((book) => book.title === titles.private), "私密词本泄漏到匿名广场");
    await guest.getByText(titles.public, { exact: true }).waitFor();
    step("匿名广场仅展示公开上传");

    guest.once("dialog", (dialog) => dialog.accept(unlisted.shareCode));
    await guest.getByRole("button", { name: "从分享码导入" }).click();
    await guest.getByRole("status").filter({ hasText: `已导入「${titles.unlisted}」` }).waitFor();
    let guestBooks = await api(guest, "/api/my/wordbooks");
    assert(guestBooks.some((book) => book.title === titles.unlisted));
    step("另一匿名浏览器通过邀请码导入成功");

    guest.once("dialog", (dialog) => dialog.accept(privateUpload.shareCode));
    await guest.getByRole("button", { name: "从分享码导入" }).click();
    await guest.getByRole("status").filter({ hasText: "分享码未能同步" }).waitFor();
    guestBooks = await api(guest, "/api/my/wordbooks");
    assert(!guestBooks.some((book) => book.title === titles.private), "私密词本可被邀请码越权导入");
    step("私密上传无法通过分享码导入");

    await owner.goto("/");
    await owner.getByRole("button", { name: "账号" }).click();
    await owner.getByRole("menuitem", { name: "退出登录" }).click();
    await owner.getByRole("button", { name: "账号" }).click();
    await owner.getByText("未登录", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    const anonymousAfterLogout = await api(owner, "/api/my/wordbooks");
    assert(!anonymousAfterLogout.some((book) => book.title === sourceTitle), "退出后仍能读取账号词本");
    await owner.goto("/wordbook");
    await owner.getByRole("heading", { name: sourceTitle }).waitFor({ state: "detached" }).catch(() => {});
    assert.equal(await owner.getByText(sourceTitle, { exact: true }).count(), 0);
    step("退出后切换到隔离的匿名数据空间");

    await owner.goto("/");
    await signIn(owner);
    const afterLogin = await api(owner, "/api/my/wordbooks");
    assert(afterLogin.some((book) => book.title === sourceTitle), "重新登录后账号词本未恢复");
    await owner.goto("/wordbook");
    await owner.getByText(sourceTitle, { exact: true }).first().waitFor();
    step("重新登录后账号数据恢复");

    await guestContext.close();
    await ownerContext.close();
    assert.deepEqual(browserErrors, [], `发现浏览器错误：\n${browserErrors.join("\n")}`);
    step("关键页面无 console.error / pageerror");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((resolveExit) => server.once("exit", () => resolveExit(true))),
        new Promise((resolveWait) => setTimeout(() => resolveWait(false), 5_000)),
      ]);
      if (!exited && server.exitCode === null) {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          server.kill("SIGKILL");
        }
        if (server.exitCode === null) {
          await new Promise((resolveExit) => server.once("exit", resolveExit));
        }
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nE2E 验收失败：${error.stack ?? error.message}`);
  process.exitCode = 1;
});
