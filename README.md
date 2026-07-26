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

## 部署

生产模式下由后端进程同时提供 API 与前端静态页面（同源），只需访问一个地址（默认 `http://localhost:3000`）。以下两种方式二选一。

### 方式一：Node 直跑（任意 OS，Node ≥ 20）

在仓库根目录依次执行：

```bash
npm run install:all   # 分别安装 backend / frontend 依赖
npm run build         # 构建前端与后端（frontend/dist、backend/dist）
npm start             # 启动生产服务
```

启动后打开 `http://localhost:3000`。`npm start` 会预检构建产物，若缺失会提示先执行 `npm run build`。可用环境变量覆盖默认行为，例如 `PORT=8080 npm start`（Windows PowerShell 用 `$env:PORT=8080; npm start`）。

### 方式二：Docker（推荐用于服务器）

在仓库根目录执行：

```bash
docker compose up -d --build
```

镜像会完成前后端构建并以非 root 的 `node` 用户运行，容器内含健康检查（`/api/health`）。停止用 `docker compose down`（加 `-v` 会一并删除数据卷，请谨慎）。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATA_FILE` | `./data/study-state.json` | 持久化文件路径，相对 `backend/` 解析 |
| `STATIC_DIR` | 构建后的 `frontend/dist`（Docker 内为 `/app/frontend/dist`） | 前端静态资源目录，设为空则关闭静态托管 |
| `FRONTEND_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | 额外允许的跨域来源（同源访问无需配置） |
| `TRUST_PROXY` | `0` | 前置反向代理的层数，用于正确识别客户端 IP（限流所需） |
| `WIKTAPI_BASE_URL` | `https://api.wiktapi.dev/v1/en/word` | 词典查询上游地址 |

### 数据备份

学习数据保存在 `backend/data/study-state.json`（Docker 部署时位于命名卷 `vacab-data` 内）。备份或迁移时复制该文件（或该卷）即可。

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
