# Vacabweb 背单词

本地优先的查词 + 背单词应用：React 前端可独立离线使用（查词、单词本、单词卡、听写），可选的 Express 后端提供词典代理、云端单词本、单词广场与学习统计。

## 目录结构

- `frontend/` — React 19 + Vite + zustand，独立 npm 包
- `backend/` — Express 5 + TypeScript，独立 npm 包（匿名 client-id 标识，JSON 文件持久化）
- `resources/` — 词典资源与前后端共享的契约数据（如 `normalize-contract.json`）

## 快速开始

后端（可选，端口 3000）：

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

前端（端口 5173）：

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

前端 `.env.local` 里的 `VITE_API_BASE=http://localhost:3000` 指向后端；不配置时前端以纯本地模式运行（内置 IELTS 词表 + 免费词典 API）。

## 校验

每个包内运行：

```bash
npm run typecheck
```

```bash
npm test
```

CI（`.github/workflows/ci.yml`）会在 push/PR 时对两个包分别执行 typecheck、测试与前端构建。

`normalizeWord` 在前后端各有一份刻意保持一致的实现，由 `resources/normalize-contract.json` 的共享用例表在两侧测试中锁定；修改任一侧请同步更新另一侧与该表。

## 更多文档

- [checkpoint.md](checkpoint.md) — 后端契约与实现说明（中文）
- [frontend-handoff.md](frontend-handoff.md) — 前端结构与对接说明
