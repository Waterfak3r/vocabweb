#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
const changedPassword = "E2e-pass-updated-2026!";
const avatarPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const visualCaptureDir = process.env.ACCOUNT_VISUAL_CAPTURE?.trim();
const sourceTitle = `匿名验收词本-${Date.now().toString(36)}`;
const titles = {
  public: `${sourceTitle}-公开`,
  unlisted: `${sourceTitle}-邀请码`,
  private: `${sourceTitle}-私密`,
};

function step(message) {
  process.stdout.write(`✓ ${message}\n`);
}

function shiftDateKey(value, amount) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day + amount);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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
    // deliberately exercises anonymous session lookup and a rejected private
    // share code (404); every other console error remains fatal.
    if (/^Failed to load resource: the server responded with a status of (401|404) \(/.test(text)) return;
    errors.push(`[${label}] console.error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    // Successful 204s (logout, password, deletion, anonymous /auth/me) are
    // often followed by a reload or navigation, so Chromium may later mark
    // their already-handled request records as aborted.
    const completedEmptyResponse = [
      "/api/auth/logout",
      "/api/auth/me",
      "/api/account/password",
      "/api/account",
    ].some((path) => new URL(request.url()).pathname === path);
    // Closing a study surface intentionally tears down its Audio element. If
    // the same-origin pronunciation redirect is still resolving, Chromium
    // reports either the original route or its final Youdao URL as aborted.
    const requestUrl = new URL(request.url());
    const youdaoPronunciation = requestUrl.origin === "https://dict.youdao.com"
      && requestUrl.pathname === "/dictvoice"
      && requestUrl.searchParams.has("audio")
      && (requestUrl.searchParams.get("type") === "1" || requestUrl.searchParams.get("type") === "2");
    const cancelledPronunciation = request.method() === "GET" && (
      /^\/api\/pronunciations\/[^/]+\/audio$/.test(requestUrl.pathname)
      || youdaoPronunciation
    );
    if ((completedEmptyResponse || cancelledPronunciation) && request.failure()?.errorText === "net::ERR_ABORTED") return;
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
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  return page.getByRole("dialog", { name: action });
}

async function openAccountMenu(page) {
  await page.getByRole("button", { name: "打开账号菜单", exact: true }).click();
}

async function signIn(page, passwordValue = password) {
  const dialog = await openAuth(page, "登录");
  await dialog.getByLabel("用户名").fill(username);
  await dialog.getByLabel("密码", { exact: true }).fill(passwordValue);
  await dialog.getByRole("button", { name: "登录", exact: true }).click();
  await openAccountMenu(page);
  await page.getByText(username, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
}

async function main() {
  const frontendBuild = resolve(repoRoot, "frontend", "dist", "index.html");
  const backendBuild = resolve(repoRoot, "backend", "dist", "server.js");
  assert(existsSync(frontendBuild) && existsSync(backendBuild), "缺少构建产物；请先运行 npm run build");
  const captureDir = visualCaptureDir ? resolve(repoRoot, visualCaptureDir) : null;
  if (captureDir) await mkdir(captureDir, { recursive: true });

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

    await owner.goto("/missing-e2e-page");
    await owner.getByRole("heading", { name: "没有找到这个页面" }).waitFor();
    assert.equal(new URL(owner.url()).pathname, "/missing-e2e-page");
    if (captureDir) {
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.screenshot({ path: join(captureDir, "not-found-mobile.png"), fullPage: true });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    await owner.getByRole("link", { name: "返回首页" }).click();
    await owner.getByRole("heading", { level: 1 }).waitFor();
    step("无效地址保留原路径并展示可恢复的 404 页面");

    await owner.getByRole("link", { name: "账号", exact: true }).click();
    await owner.waitForURL((url) => url.pathname === "/account");
    await owner.getByRole("heading", { name: "账户资料" }).waitFor();
    assert.equal(await owner.locator("label.account-style-option").count(), 6);
    await owner.getByLabel("快切风格一").selectOption("dusk");
    await owner.getByLabel("快切风格二").selectOption("city-pop");
    await owner.locator('label.account-style-option', { hasText: "黄昏" }).click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "dusk");
    await owner.getByRole("button", { name: "切换到City Pop风格" }).click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "city-pop");
    assert.equal(await owner.locator('label.account-style-option', { hasText: "City Pop" }).locator('input').isChecked(), true);
    assert.equal(
      await owner.evaluate(() => localStorage.getItem("vocab-ielts:theme-quick-switch:v1")),
      JSON.stringify(["dusk", "city-pop"]),
    );
    await owner.getByLabel("快切风格一").selectOption("paper");
    await owner.getByLabel("快切风格二").selectOption("graphite");
    await owner.locator('label.account-style-option', { hasText: "纸白" }).click();
    await owner.goto("/");
    step("匿名用户可从账号入口配置两套导航快切风格");

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
    await register.getByLabel("密码", { exact: true }).fill(password);
    const confirmation = register.getByLabel("确认密码", { exact: true });
    await confirmation.fill(`${password}x`);
    await confirmation.press("Tab");
    await register.getByText("两次输入的密码不一致。").waitFor();
    assert.equal(await register.getByRole("button", { name: "注册", exact: true }).isDisabled(), true);
    await register.getByRole("button", { name: "显示密码" }).click();
    assert.equal(await register.getByLabel("密码", { exact: true }).getAttribute("type"), "text");
    assert.equal(await confirmation.getAttribute("type"), "text");
    await register.getByRole("button", { name: "隐藏密码" }).click();
    await confirmation.fill(password);
    if (captureDir) {
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.screenshot({ path: join(captureDir, "register-mobile.png"), fullPage: true });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    await register.getByRole("button", { name: "注册", exact: true }).click();
    await openAccountMenu(owner);
    await owner.getByText(username, { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    const afterRegister = await api(owner, "/api/my/wordbooks");
    assert(afterRegister.some((book) => book.title === sourceTitle), "注册后匿名词本丢失");
    await owner.goto("/wordbook");
    await owner.getByText(sourceTitle, { exact: true }).first().waitFor();
    step("注册成功，匿名词本完整保留");

    await owner.getByRole("link", { name: "账号", exact: true }).click();
    await owner.waitForURL((url) => url.pathname === "/account");
    await owner.getByRole("heading", { name: "个人资料" }).waitFor();
    await owner.locator(".account-metrics dd").first().waitFor();
    assert.deepEqual(await owner.locator(".account-metrics dd").allTextContents(), ["1", "1", "0"]);
    const graphiteStyle = owner.locator('label.account-style-option', { hasText: "石墨纸" });
    const paperStyle = owner.locator('label.account-style-option', { hasText: "纸白" });
    const duskStyle = owner.locator('label.account-style-option', { hasText: "黄昏" });
    const cityPopStyle = owner.locator('label.account-style-option', { hasText: "City Pop" });
    const classicLightStyle = owner.locator('label.account-style-option', { hasText: "原版白天" });
    const classicDarkStyle = owner.locator('label.account-style-option', { hasText: "原版黑夜" });
    await duskStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "dusk");
    await cityPopStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "city-pop");
    await classicLightStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "classic-light");
    await classicDarkStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "classic-dark");
    await paperStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "paper");
    await owner.getByLabel("快切风格一").selectOption("dusk");
    await owner.getByLabel("快切风格二").selectOption("city-pop");
    await owner.getByRole("button", { name: "切换到黄昏风格" }).click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "dusk");
    await owner.getByRole("button", { name: "切换到City Pop风格" }).click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "city-pop");
    await owner.getByLabel("快切风格一").selectOption("paper");
    await owner.getByLabel("快切风格二").selectOption("graphite");
    await paperStyle.click();
    await owner.waitForFunction(() => document.documentElement.dataset.theme === "paper");
    assert.equal(await paperStyle.locator('input').isChecked(), true);
    step("账户页可选择六套风格并指定两套导航快切风格");
    const dailyView = owner.getByRole("button", { name: "每日视图" });
    const weeklyView = owner.getByRole("button", { name: "每周视图" });
    const cumulativeView = owner.getByRole("button", { name: "累计视图" });
    assert.equal(await dailyView.getAttribute("aria-pressed"), "true");
    await weeklyView.click();
    await owner.locator(".account-weekly-chart").waitFor();
    assert.equal(await weeklyView.getAttribute("aria-pressed"), "true");
    await cumulativeView.click();
    await owner.locator(".account-cumulative-chart").waitFor();
    assert.equal(await cumulativeView.getAttribute("aria-pressed"), "true");
    await dailyView.click();
    await owner.locator(".account-heatmap-grid").waitFor();
    const customRangeButton = owner.getByRole("button", { name: "自定义时间范围" });
    assert.equal(await customRangeButton.getAttribute("aria-expanded"), "false");
    await customRangeButton.click();
    const customRangeForm = owner.locator("#account-activity-custom-range");
    await customRangeForm.waitFor();
    assert.equal(await customRangeButton.getAttribute("aria-expanded"), "true");
    assert.equal(await owner.evaluate(() => document.activeElement?.id), "account-activity-custom-start");
    if (captureDir) {
      const activity = owner.locator(".account-activity");
      await owner.setViewportSize({ width: 1440, height: 900 });
      await activity.screenshot({ path: join(captureDir, "account-activity-custom-range-desktop-paper.png") });
      await owner.getByRole("button", { name: "切换到石墨纸风格" }).click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "graphite");
      await owner.waitForTimeout(220);
      await activity.screenshot({ path: join(captureDir, "account-activity-custom-range-desktop-graphite.png") });
      await paperStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "paper");
      await owner.waitForTimeout(220);
      await owner.setViewportSize({ width: 390, height: 844 });
      await activity.screenshot({ path: join(captureDir, "account-activity-custom-range-mobile-paper.png") });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    await owner.keyboard.press("Escape");
    assert.equal(await customRangeButton.getAttribute("aria-expanded"), "false");
    await customRangeButton.click();
    await customRangeForm.waitFor();
    const customStart = owner.getByLabel("开始日期");
    const customEnd = owner.getByLabel("结束日期");
    const minimumActivityDate = await customStart.getAttribute("min");
    assert.ok(minimumActivityDate);
    await customStart.fill(minimumActivityDate);
    await customEnd.fill(shiftDateKey(minimumActivityDate, 13));
    await customRangeForm.getByRole("button", { name: "应用", exact: true }).click();
    assert.equal(await customRangeButton.getAttribute("aria-pressed"), "true");
    await owner.locator(".account-activity-day-detail").waitFor();
    assert.match((await owner.locator(".account-heatmap-meta > p").textContent()) ?? "", /14 天/);
    if (captureDir) {
      const activity = owner.locator(".account-activity");
      await owner.setViewportSize({ width: 1440, height: 900 });
      await activity.screenshot({ path: join(captureDir, "account-activity-custom-range-applied-desktop-paper.png") });
      await owner.setViewportSize({ width: 390, height: 844 });
      await activity.screenshot({ path: join(captureDir, "account-activity-custom-range-applied-mobile-paper.png") });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    await owner.getByRole("button", { name: "90 天", exact: true }).click();
    assert.equal(await owner.getByRole("button", { name: "90 天", exact: true }).getAttribute("aria-pressed"), "true");
    step("个人资料页展示真实学习统计并可切换每日、每周与累计视图");

    const avatarInput = owner.getByLabel("选择头像图片");
    const avatarFile = { name: "avatar.png", mimeType: "image/png", buffer: avatarPng };
    await avatarInput.setInputFiles(avatarFile);
    await owner.getByText("头像已更新。", { exact: true }).waitFor();
    const heroAvatarImage = owner.locator(".account-hero-avatar img");
    await heroAvatarImage.waitFor();
    const firstAvatarUrl = await heroAvatarImage.getAttribute("src");
    assert.match(firstAvatarUrl ?? "", /^\/api\/account\/avatar\/[A-Za-z0-9-]+$/);
    assert.equal(await owner.locator(".account-trigger .user-avatar img").count(), 1);

    await avatarInput.setInputFiles(avatarFile);
    await owner.waitForFunction(
      (previousUrl) => document.querySelector(".account-hero-avatar img")?.getAttribute("src") !== previousUrl,
      firstAvatarUrl,
    );
    await heroAvatarImage.dispatchEvent("error");
    await owner.locator(".account-trigger .user-avatar img").dispatchEvent("error");
    await heroAvatarImage.waitFor({ state: "detached" });
    assert.notEqual((await owner.locator(".account-hero-avatar").textContent())?.trim(), "");
    assert.equal(await owner.locator(".account-trigger .user-avatar img").count(), 0);

    await owner.reload();
    await owner.getByRole("heading", { name: "个人资料" }).waitFor();
    await heroAvatarImage.waitFor();
    const replacementAvatarUrl = await heroAvatarImage.getAttribute("src");
    assert.notEqual(replacementAvatarUrl, firstAvatarUrl);
    await owner.getByRole("button", { name: "移除", exact: true }).click();
    await owner.getByText("已恢复为默认字母头像。", { exact: true }).waitFor();
    await heroAvatarImage.waitFor({ state: "detached" });
    assert.equal(await owner.locator(".account-trigger .user-avatar img").count(), 0);
    step("头像可上传、即时同步、失败回退、刷新恢复、替换并删除");

    if (captureDir) {
      await owner.setViewportSize({ width: 1440, height: 900 });
      await owner.screenshot({ path: join(captureDir, "account-page-paper.png"), fullPage: true });
      await owner.getByRole("button", { name: "切换到石墨纸风格" }).click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "graphite");
      await owner.waitForTimeout(220);
      await owner.screenshot({ path: join(captureDir, "account-page-graphite.png"), fullPage: true });
      await duskStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "dusk");
      await owner.waitForTimeout(220);
      await owner.screenshot({ path: join(captureDir, "account-page-dusk.png"), fullPage: true });
      await cityPopStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "city-pop");
      await owner.waitForTimeout(220);
      await owner.screenshot({ path: join(captureDir, "account-page-city-pop.png"), fullPage: true });
      await classicLightStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "classic-light");
      await owner.waitForTimeout(220);
      await owner.screenshot({ path: join(captureDir, "account-page-classic-light.png"), fullPage: true });
      await classicDarkStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "classic-dark");
      await owner.waitForTimeout(220);
      await owner.screenshot({ path: join(captureDir, "account-page-classic-dark.png"), fullPage: true });
      await cityPopStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "city-pop");
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.screenshot({ path: join(captureDir, "account-page-mobile-city-pop.png"), fullPage: true });
      await paperStyle.click();
      await owner.waitForFunction(() => document.documentElement.dataset.theme === "paper");
      await owner.setViewportSize({ width: 1280, height: 720 });
      step("账户资料页视觉快照已生成");
    }

    const mobileBookTitles = Array.from({ length: 22 }, (_, index) => `移动验收词本 ${String(index + 2).padStart(2, "0")}`);
    for (const title of mobileBookTitles) {
      await api(owner, "/api/my/wordbooks", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: "用于验证大量词本时的移动导航",
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
    }

    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto("/wordbook");
    const bookToggle = owner.locator('button[aria-controls="workspace-book-picker"]');
    await bookToggle.waitFor();
    assert.equal(await bookToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await owner.locator("#workspace-book-picker").isHidden(), true);
    await bookToggle.click();
    assert.equal(await bookToggle.getAttribute("aria-expanded"), "true");
    const targetBookTitle = mobileBookTitles[10];
    await owner.locator(".workspace-book-list > button", { hasText: targetBookTitle }).click();
    await owner.getByRole("heading", { name: targetBookTitle, exact: true }).waitFor();
    await owner.waitForTimeout(350);
    assert.equal(await bookToggle.getAttribute("aria-expanded"), "false");
    assert.equal(await owner.evaluate(() => document.activeElement?.id), "workspace-title");
    const sidebarBox = await owner.locator(".workspace-sidebar").boundingBox();
    assert(sidebarBox && sidebarBox.height < 700, `折叠后的移动词书栏仍过高：${sidebarBox?.height}`);
    if (captureDir) await owner.screenshot({ path: join(captureDir, "wordbook-mobile-collapsed.png"), fullPage: true });
    step("23 本词书在手机端默认折叠，切换后直接显示当前词书");

    const createTrigger = owner.getByRole("button", { name: "创建单词本", exact: true }).first();
    await createTrigger.click();
    const importDialog = owner.getByRole("dialog", { name: "新建单词本" });
    await importDialog.waitFor();
    assert.equal(await owner.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await importDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await importDialog.getByRole("button", { name: "关闭", exact: true }).focus();
    await owner.keyboard.press("Shift+Tab");
    assert.equal(await importDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await owner.keyboard.press("Escape");
    await importDialog.waitFor({ state: "hidden" });
    await owner.waitForTimeout(50);
    assert.equal(await createTrigger.evaluate((trigger) => trigger === document.activeElement), true);

    let fullWordListRequests = 0;
    let roundStartRequests = 0;
    const observeStudyRequests = (request) => {
      const url = new URL(request.url());
      if (/^\/api\/my\/wordbooks\/[^/]+\/words$/.test(url.pathname)) fullWordListRequests += 1;
      if (url.pathname === "/api/study/rounds" && request.method() === "POST") roundStartRequests += 1;
    };
    owner.on("request", observeStudyRequests);

    const studyTrigger = owner.locator(".plan-card", { hasText: "新词学习" }).first().locator("button:not(.plan-card-settings)").first();
    await studyTrigger.click();
    const studyDialog = owner.getByRole("dialog", { name: "新词学习悬浮窗口" });
    await studyDialog.waitFor();
    await owner.waitForFunction(
      (dialog) => dialog.contains(document.activeElement),
      await studyDialog.elementHandle(),
    );
    await studyDialog.getByRole("button", { name: "关闭学习窗口" }).focus();
    await owner.keyboard.press("Shift+Tab");
    assert.equal(await studyDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await studyDialog.getByRole("button", { name: "认识", exact: true }).click();
    await studyDialog.getByText("看词选义", { exact: false }).waitFor();
    await owner.waitForTimeout(200);
    await owner.keyboard.press("Escape");
    await studyDialog.waitFor({ state: "hidden" });
    await owner.waitForTimeout(50);
    assert.equal(await studyTrigger.evaluate((trigger) => trigger === document.activeElement), true);
    assert.notEqual(await owner.evaluate(() => document.body.style.overflow), "hidden");

    const reviewTrigger = owner.locator(".quick-actions > button", { hasText: "复习巩固" });
    await reviewTrigger.click();
    const reviewDialog = owner.getByRole("dialog", { name: "复习巩固悬浮窗口" });
    await reviewDialog.waitFor();
    await reviewDialog.getByRole("button", { name: "关闭学习窗口" }).click();
    await reviewDialog.waitFor({ state: "hidden" });
    await owner.waitForTimeout(50);
    owner.off("request", observeStudyRequests);
    assert.equal(roundStartRequests, 2, "新词和复习应分别由轮次接口选词");
    assert.equal(fullWordListRequests, 0, "新词或复习不应读取整个单词本");

    const wordManagerTrigger = owner.getByRole("button", { name: "浏览词条", exact: true });
    await wordManagerTrigger.click();
    const wordManagerDialog = owner.getByRole("dialog", { name: targetBookTitle });
    await wordManagerDialog.waitFor();
    assert.equal(await owner.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await wordManagerDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await wordManagerDialog.getByRole("button", { name: "关闭", exact: true }).focus();
    await owner.keyboard.press("Shift+Tab");
    assert.equal(await wordManagerDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
    await owner.keyboard.press("Escape");
    await wordManagerDialog.waitFor({ state: "hidden" });
    const wordManagerTriggerHandle = await wordManagerTrigger.elementHandle();
    assert(wordManagerTriggerHandle);
    await owner.waitForFunction(
      (trigger) => trigger === document.activeElement,
      wordManagerTriggerHandle,
    );
    assert.equal(await wordManagerTrigger.evaluate((trigger) => trigger === document.activeElement), true);
    assert.notEqual(await owner.evaluate(() => document.body.style.overflow), "hidden");
    step("新词与复习仅读取当前轮次词条，弹窗焦点和页面滚动保持正确");

    const identityBeforeReset = await owner.evaluate(() => {
      localStorage.setItem("vocab-ielts:theme:v1", "graphite");
      localStorage.setItem("vocab-ielts:theme-quick-switch:v1", JSON.stringify(["dusk", "city-pop"]));
      localStorage.setItem("unrelated-e2e", "keep");
      return localStorage.getItem("vocab-ielts:client-id:v1");
    });
    await owner.goto("/privacy");
    owner.once("dialog", (dialog) => dialog.accept());
    await owner.getByRole("button", { name: "重置本机偏好与缓存" }).click();
    await owner.waitForURL((url) => url.pathname === "/");
    const resetState = await owner.evaluate(() => ({
      clientId: localStorage.getItem("vocab-ielts:client-id:v1"),
      theme: localStorage.getItem("vocab-ielts:theme:v1"),
      quickThemes: localStorage.getItem("vocab-ielts:theme-quick-switch:v1"),
      unrelated: localStorage.getItem("unrelated-e2e"),
    }));
    assert.equal(resetState.clientId, identityBeforeReset);
    assert.equal(resetState.theme, null);
    assert.equal(resetState.quickThemes, null);
    assert.equal(resetState.unrelated, "keep");
    step("重置本机偏好保留匿名数据身份并仅清理应用偏好");
    await owner.setViewportSize({ width: 1280, height: 720 });

    let marketplaceMeRequests = 0;
    const countMarketplaceMe = (request) => {
      if (new URL(request.url()).pathname === "/api/auth/me") marketplaceMeRequests += 1;
    };
    owner.on("request", countMarketplaceMe);
    await owner.goto("/marketplace");
    await owner.getByRole("heading", { name: "共享单词本广场" }).waitFor();

    const guestContext = await browser.newContext({ baseURL: baseUrl, locale: "zh-CN" });
    const guest = await guestContext.newPage();
    watchPage(guest, "匿名导入浏览器", browserErrors);
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.goto("/marketplace");
    await guest.getByRole("heading", { name: "共享单词本广场" }).waitFor();
    await guest.getByText("使用分享码导入词库；登录后可分享自己的词库。").waitFor();
    assert.equal(await guest.getByRole("button", { name: "上传我的词库" }).count(), 0);
    assert.equal(await guest.getByRole("button", { name: "上传第一本词库" }).count(), 0);
    if (captureDir) {
      await guest.screenshot({
        path: join(captureDir, "marketplace-anonymous-empty-mobile.png"),
        fullPage: true,
      });
    }
    step("匿名空广场隐藏上传词库入口");

    await guest.goto("/messages");
    await guest.getByLabel("昵称").fill("匿名验收者");
    const contactField = guest.getByRole("textbox", { name: "联系方式 选填，仅站长可见", exact: true });
    await contactField.fill("private-contact@example.test");
    await guest.getByLabel("留言内容").fill("第一条留言用于验证私密联系方式不会残留。");
    const firstMessageRequest = guest.waitForRequest((request) => new URL(request.url()).pathname === "/api/messages" && request.method() === "POST");
    await guest.getByRole("button", { name: "发布留言" }).click();
    const firstMessagePayload = (await firstMessageRequest).postDataJSON();
    assert.equal(firstMessagePayload.contact, "private-contact@example.test");
    await guest.locator(".message-item").filter({ hasText: "第一条留言用于验证私密联系方式不会残留。" }).waitFor();
    await guest.waitForFunction(() => {
      const field = document.querySelector('.message-composer input[placeholder="邮箱、QQ 或其他联系方式"]');
      return field instanceof HTMLInputElement && field.value === "";
    });
    assert.equal(await contactField.inputValue(), "");
    await guest.getByLabel("留言内容").fill("第二条留言不应再次携带上一条的联系方式。");
    const secondMessageRequest = guest.waitForRequest((request) => new URL(request.url()).pathname === "/api/messages" && request.method() === "POST");
    await guest.getByRole("button", { name: "发布留言" }).click();
    const secondMessagePayload = (await secondMessageRequest).postDataJSON();
    assert.equal(Object.hasOwn(secondMessagePayload, "contact"), false);
    await guest.locator(".message-item").filter({ hasText: "第二条留言不应再次携带上一条的联系方式。" }).waitFor();
    if (captureDir) await guest.screenshot({ path: join(captureDir, "messages-contact-cleared-mobile.png"), fullPage: true });
    step("匿名留言成功后清空私密联系方式，后续留言不会误带旧值");
    await guest.goto("/marketplace");
    await guest.getByRole("heading", { name: "共享单词本广场" }).waitFor();

    await owner.getByRole("button", { name: "上传我的词库" }).waitFor();
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
    assert.equal(marketplaceMeRequests, 1, `单词广场重复请求登录态：${marketplaceMeRequests}`);
    owner.off("request", countMarketplaceMe);
    step("单词广场与页头共用一次登录态判定");
    step("三档可见性均通过页面发布并保存正确");

    const publicUpload = uploads.find((book) => book.title === titles.public);
    assert(publicUpload?.id && publicUpload.sourceWordbookId && publicUpload.headRevisionId);
    let revisionHead = publicUpload.headRevisionId;
    for (let index = 1; index <= 21; index += 1) {
      const updated = await api(owner, `/api/catalog/wordbooks/${publicUpload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sourceWordbookId: publicUpload.sourceWordbookId,
          expectedHeadRevisionId: revisionHead,
          description: `分页回归版本 ${index}`,
          message: `分页回归版本 ${String(index).padStart(2, "0")}`,
        }),
      });
      revisionHead = updated.headRevisionId;
    }
    await owner.goto(`/marketplace/${publicUpload.id}?tab=revisions`);
    const revisionLinks = owner.locator(".market-revision-list > a");
    await revisionLinks.first().waitFor();
    assert.equal(await revisionLinks.count(), 20);
    await owner.getByRole("button", { name: "加载更多版本" }).click();
    await owner.waitForFunction(() => document.querySelectorAll(".market-revision-list > a").length === 22);
    assert.equal(await revisionLinks.count(), 22);
    if (captureDir) {
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.screenshot({ path: join(captureDir, "revision-pagination-mobile.png"), fullPage: true });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    step("协作详情可继续加载第 21 条后的版本记录");

    await owner.goto("/marketplace");
    const marketplaceSearch = owner.getByLabel("搜索词库");
    await marketplaceSearch.fill(titles.public);
    await owner.getByRole("combobox", { name: "排序" }).selectOption("latest");
    await owner.getByRole("button", { name: "列表视图" }).click();
    await owner.waitForURL((url) => url.searchParams.get("q") === titles.public && url.searchParams.get("sort") === "latest" && url.searchParams.get("view") === "list");
    await owner.getByRole("link", { name: `查看「${titles.public}」概况` }).click();
    await owner.getByRole("heading", { name: titles.public, exact: true }).waitFor();
    await owner.getByRole("link", { name: "返回单词广场" }).click();
    await owner.getByRole("heading", { name: "共享单词本广场" }).waitFor();
    assert.equal(await marketplaceSearch.inputValue(), titles.public);
    assert.equal(await owner.getByRole("combobox", { name: "排序" }).inputValue(), "latest");
    assert.equal(await owner.getByRole("button", { name: "列表视图" }).getAttribute("class"), "active");
    if (captureDir) {
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.reload();
      await owner.getByRole("heading", { name: "共享单词本广场" }).waitFor();
      assert.equal(await owner.getByLabel("搜索词库").inputValue(), titles.public);
      await owner.screenshot({ path: join(captureDir, "marketplace-context-restored-mobile.png"), fullPage: true });
      await owner.setViewportSize({ width: 1280, height: 720 });
    }
    step("从详情返回后保留广场搜索、排序和视图上下文");

    await guest.setViewportSize({ width: 1280, height: 720 });
    await guest.reload();
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
    await openAccountMenu(owner);
    await owner.getByRole("menuitem", { name: "退出登录" }).click();
    await openAccountMenu(owner);
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

    await owner.goto("/account");
    await owner.getByRole("heading", { name: "个人资料" }).waitFor();
    const [download] = await Promise.all([
      owner.waitForEvent("download"),
      owner.getByRole("button", { name: "导出数据", exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^vacabweb-export-\d{4}-\d{2}-\d{2}\.json$/);
    await owner.getByText("数据导出文件已生成。", { exact: true }).waitFor();
    step("账户数据可从资料页下载");

    await owner.getByLabel("当前密码").fill(password);
    await owner.getByLabel("新密码", { exact: true }).fill(changedPassword);
    await owner.getByLabel("确认新密码").fill(changedPassword);
    await owner.getByRole("button", { name: "更新密码", exact: true }).click();
    await owner.getByText("密码已更新，其他设备上的登录已退出。", { exact: true }).waitFor();
    step("账户资料页可更新密码");

    await openAccountMenu(owner);
    await owner.getByRole("menuitem", { name: "退出登录" }).click();
    await openAccountMenu(owner);
    await owner.getByText("未登录", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    await signIn(owner, changedPassword);
    step("新密码可重新登录，旧会话流程保持完整");

    await owner.goto("/account");
    await owner.getByRole("button", { name: "注销账号", exact: true }).click();
    const deleteDialog = owner.getByRole("dialog", { name: "永久注销账号" });
    await deleteDialog.getByLabel(`输入用户名“${username}”确认`).fill(username);
    await deleteDialog.getByLabel("当前密码").fill(changedPassword);
    if (captureDir) {
      await owner.screenshot({
        path: join(captureDir, "account-delete-dialog.png"),
        fullPage: true,
      });
    }
    await deleteDialog.getByRole("button", { name: "永久注销", exact: true }).click();
    await owner.waitForURL((url) => url.pathname === "/");
    await openAccountMenu(owner);
    await owner.getByText("未登录", { exact: true }).waitFor();
    await owner.keyboard.press("Escape");
    step("注销确认对话框删除账号并回到匿名状态");

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
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }).catch((error) => {
      console.warn(`E2E 临时目录清理失败：${error.message}`);
    });
  }
}

main().catch((error) => {
  console.error(`\nE2E 验收失败：${error.stack ?? error.message}`);
  process.exitCode = 1;
});
