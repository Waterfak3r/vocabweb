#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const clientIdKey = "vocab-ielts:client-id:v1";
const suffix = Date.now().toString(36);
const password = "E2e-collab-2026!";
const visualDir = process.env.COLLAB_VISUAL_CAPTURE?.trim();

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
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("未找到系统 Chrome；请通过 PLAYWRIGHT_CHROME_PATH 指定可执行文件。");
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
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitForServer(baseUrl, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`生产服务提前退出 (${child.exitCode})\n${logs.join("")}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Service is still starting.
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
    // Each fresh browser asks /api/auth/me once before the test registers it.
    if (/^Failed to load resource: the server responded with a status of 401 \(/.test(text)) return;
    errors.push(`[${label}] console.error: ${text}`);
  });
  page.on("requestfailed", (request) => {
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
  if (!result.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function register(page, username) {
  return api(page, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

async function capture(page, name) {
  if (!visualDir) return;
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: join(visualDir, name), fullPage: true });
}

async function main() {
  assert(
    existsSync(resolve(repoRoot, "frontend", "dist", "index.html"))
      && existsSync(resolve(repoRoot, "backend", "dist", "server.js")),
    "缺少构建产物；请先运行 npm run build",
  );
  const tempDir = await mkdtemp(join(tmpdir(), "vacabweb-collab-e2e-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const server = spawn(process.execPath, ["scripts/start-prod.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_FILE: join(tempDir, "study.sqlite"),
      DATA_FILE: join(tempDir, "legacy.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  let browser;
  const browserErrors = [];
  try {
    await waitForServer(baseUrl, server, logs);
    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ["--disable-background-networking"] });
    const publisherContext = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
    const contributorContext = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
    const publisher = await publisherContext.newPage();
    const contributor = await contributorContext.newPage();
    watchPage(publisher, "发布者", browserErrors);
    watchPage(contributor, "贡献者", browserErrors);
    await Promise.all([publisher.goto("/"), contributor.goto("/")]);
    await register(publisher, `发布者_${suffix}`);
    await register(contributor, `贡献者_${suffix}`);

    const source = await api(publisher, "/api/my/wordbooks", {
      method: "POST",
      body: JSON.stringify({
        title: `协作验收词书_${suffix}`,
        description: "用于协作、合并和回滚验收",
        words: [
          { word: "alpha", phonetic: "/alpha/", meanings: [{ pos: "noun", definition: "first letter" }], source: "user", zhMeaning: "甲", zhMeaningSource: "user" },
          { word: "beta", phonetic: "/beta/", meanings: [{ pos: "noun", definition: "second letter" }], source: "user", zhMeaning: "乙", zhMeaningSource: "user" },
        ],
      }),
    });
    const catalog = await api(publisher, "/api/catalog/uploads", {
      method: "POST",
      body: JSON.stringify({ sourceWordbookId: source.id, visibility: "public", message: "首次发布" }),
    });
    step("发布者创建公开、可协作词书");

    await publisher.goto(`/marketplace?collection=uploads&focus=${catalog.id}`);
    const uploadedCard = publisher.locator(`#market-book-${catalog.id}`);
    await uploadedCard.waitFor();
    assert.equal(await uploadedCard.locator(".market-card-version").count(), 0);
    await capture(publisher, "05-market-card-clean-light.png");

    await contributor.goto(`/marketplace/${catalog.id}`);
    await contributor.getByRole("button", { name: "加入词本" }).click();
    await contributor.getByRole("button", { name: "已加入词本" }).waitFor();
    const contributorBooks = await api(contributor, "/api/my/wordbooks");
    const joined = contributorBooks.find((book) => book.sourceCatalogId === catalog.id);
    assert(joined);
    await contributor.goto("/wordbook");
    await contributor.getByRole("heading", { name: joined.title, exact: true }).waitFor();
    const downloadPromise = contributor.waitForEvent("download");
    await contributor.getByRole("button", { name: "导出 CSV" }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /-单词表\.csv$/);
    const csvPath = join(tempDir, "contributor-edited.csv");
    await download.saveAs(csvPath);
    const exported = await readFile(csvPath, "utf8");
    assert.match(exported, /"单词","音标","词性","英文释义","中文释义","例句"/);
    await writeFile(csvPath, exported.replace('"甲"', '"阿尔法，希腊字母表首字母"'), "utf8");

    await contributor.getByRole("button", { name: "导入文件" }).click();
    const importDialog = contributor.getByRole("dialog", { name: "导入到单词本" });
    await importDialog.locator('input[type="file"]').setInputFiles(csvPath);
    await importDialog.getByRole("button", { name: "解析并预览" }).click();
    await importDialog.getByRole("radio", { name: /覆盖原单词本/ }).check();
    await importDialog.getByRole("button", { name: "确认覆盖范围" }).click();
    const overwriteDialog = contributor.getByRole("alertdialog", { name: "确定覆盖原单词本？" });
    await overwriteDialog.getByRole("button", { name: "确认覆盖" }).click();
    await contributor.getByRole("status").filter({ hasText: `已更新「${joined.title}」` }).waitFor();
    const importedWords = await api(contributor, `/api/my/wordbooks/${joined.id}/words`);
    assert.equal(importedWords.find((word) => word.word === "alpha")?.zhMeaning, "阿尔法，希腊字母表首字母");
    await capture(contributor, "06-wordbook-file-actions-light.png");
    step("贡献者导出 CSV、批量修改并覆盖导入个人副本");

    await contributor.goto(`/marketplace/${catalog.id}?tab=contributions`);
    const contributionUrl = contributor.url();
    const directSubmit = contributor.getByRole("button", { name: "从个人副本提交" });
    await directSubmit.waitFor();
    await capture(contributor, "07-direct-submit-entry-light.png");
    await directSubmit.click();
    const submitDialog = contributor.getByRole("dialog", { name: "提交改进" });
    await submitDialog.getByText("± 修改").waitFor();
    assert.equal(await contributor.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await submitDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await submitDialog.getByRole("button", { name: "关闭", exact: true }).focus();
    await contributor.keyboard.press("Shift+Tab");
    assert.equal(await submitDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    assert.equal(await submitDialog.getByText("内容来源", { exact: true }).count(), 0);
    assert.equal(contributor.url(), contributionUrl);
    await submitDialog.getByLabel("建议标题").fill("完善 alpha 中文释义");
    await submitDialog.getByLabel("补充说明").fill("补充更准确的学习释义。");
    await capture(contributor, "01-submit-preview-light.png");
    await submitDialog.getByRole("button", { name: "提交给发布者" }).click();
    await contributor.getByRole("status").filter({ hasText: "已提交" }).waitFor();
    await contributor.waitForFunction(() => document.activeElement?.textContent?.trim() === "从个人副本提交", null, { timeout: 2_000 });
    assert.equal(await directSubmit.evaluate((trigger) => trigger === document.activeElement), true);
    assert.notEqual(await contributor.evaluate(() => document.body.style.overflow), "hidden");
    const authored = await api(contributor, "/api/account/contributions?scope=authored&limit=20");
    const contribution = authored.items[0];
    assert(contribution?.id);
    step("共享红绿预览提交成功");

    await publisher.goto(`/marketplace/${catalog.id}/contributions/${contribution.id}`);
    await publisher.getByRole("button", { name: "合并全部变化" }).waitFor();
    await publisher.getByRole("button", { name: "切换到黑夜模式" }).click();
    await capture(publisher, "02-audit-dark.png");
    await publisher.getByRole("button", { name: "合并全部变化" }).click();
    const revisionLink = publisher.getByRole("link", { name: "查看合并版本" });
    await revisionLink.waitFor();
    await revisionLink.click();
    await publisher.getByRole("heading", { name: "完善 alpha 中文释义", exact: true }).waitFor();
    step("发布者审核并原子合并整条建议");

    await publisher.getByRole("button", { name: "回滚此版本" }).click();
    const revertDialog = publisher.getByRole("alertdialog", { name: "确认回滚此版本" });
    await revertDialog.getByText("反向版本预览").waitFor();
    assert.equal(await publisher.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await revertDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await revertDialog.getByRole("button", { name: "关闭", exact: true }).focus();
    await publisher.keyboard.press("Shift+Tab");
    assert.equal(await revertDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await capture(publisher, "03-revert-preview-dark.png");
    await revertDialog.getByRole("button", { name: "创建回滚版本" }).click();
    await publisher.getByText("回滚", { exact: false }).first().waitFor();
    const restored = await api(publisher, `/api/catalog/wordbooks/${catalog.id}`);
    assert.equal(restored.words.find((word) => word.word === "alpha")?.zhMeaning, "甲");
    step("回滚新增反向版本且恢复公开词条");

    await publisher.setViewportSize({ width: 390, height: 844 });
    await publisher.goto(`/marketplace/${catalog.id}/revisions/${restored.headRevisionId}`);
    await publisher.getByRole("heading", { level: 1 }).waitFor();
    await capture(publisher, "04-version-mobile-dark.png");
    step("桌面亮色、桌面深色和移动端页面均完成渲染");

    assert.deepEqual(browserErrors, [], browserErrors.join("\n"));
    process.stdout.write("\n协作改进、审计、合并与回滚 E2E 通过。\n");
  } finally {
    await browser?.close().catch(() => undefined);
    if (server.exitCode === null) server.kill();
    await new Promise((resolveWait) => {
      if (server.exitCode !== null) resolveWait();
      else server.once("exit", resolveWait);
    });
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
