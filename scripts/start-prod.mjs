#!/usr/bin/env node
// 生产启动器：跨平台运行已构建的后端，并让后端托管前端静态资源。
// 用法：先 `npm run build`，再从仓库根目录执行 `npm start`（即 `node scripts/start-prod.mjs`）。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ 直接位于仓库根目录下，向上一级即仓库根。
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const backendDir = resolve(repoRoot, "backend");
const backendEntry = resolve(backendDir, "dist", "server.js");
const frontendDist = resolve(repoRoot, "frontend", "dist");
const frontendIndex = resolve(frontendDist, "index.html");

// 预检：缺少任一构建产物都无法进入生产模式。
const missing = [];
if (!existsSync(frontendIndex)) {
  missing.push(`  - 前端构建产物缺失：${frontendIndex}`);
}
if (!existsSync(backendEntry)) {
  missing.push(`  - 后端构建产物缺失：${backendEntry}`);
}

if (missing.length > 0) {
  console.error("无法启动生产服务，检测到构建产物缺失：");
  console.error(missing.join("\n"));
  console.error("");
  console.error("请先在仓库根目录执行构建，然后再启动：");
  console.error("  npm run build");
  console.error("  npm start");
  process.exit(1);
}

// 尊重用户对每个环境变量的覆盖（PORT、DATA_FILE 等）；仅为未设置的项提供生产默认值。
const childEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "production",
  STATIC_DIR: process.env.STATIC_DIR ?? frontendDist,
};

// 后端进程的工作目录固定为 backend/：
//  - DATA_FILE 默认 ./data/study-state.json 相对该目录解析；
//  - 编译后的 dist/study 依赖 ../../../resources 这一相对布局。
const child = spawn(process.execPath, ["dist/server.js"], {
  cwd: backendDir,
  stdio: "inherit",
  env: childEnv,
});

// 将终止信号转发给子进程，实现优雅关闭（Windows 下能力有限，但保持一致处理）。
const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error("启动后端进程失败：", error);
  process.exit(1);
});

// 透传子进程退出码；若被信号终止则以非零码退出。
child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
