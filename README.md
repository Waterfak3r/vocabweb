# Vacabweb 背单词

本地优先的查词 + 背单词应用：生产后端预载 OEWN 2025 英文释义与 ECDICT 中文释义，仅在本地英文未命中时使用在线词典补充；在线发音优先播放有道词典提供的英音或美音，音频不可用时才回退浏览器语音。React 前端支持中英文释义切换、单词本、单词卡和听写。Express 后端还提供账号同步、账户资料与改密、学习统计、单词社区与公开楼中楼留言板。

## 目录结构

- `frontend/` — React 19 + Vite + zustand，独立 npm 包
- `backend/` — Express 5 + TypeScript + SQLite，独立 npm 包（scrypt 密码、HttpOnly 会话、匿名数据合并）
- `resources/` — 词典资源与前后端共享的契约数据（如 `normalize-contract.json`）

## 快速开始

后端（可选，端口 3000）：

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

前端（端口 5173）：

```bash
cd frontend && npm install && npm run dev
```

开发模式由 Vite 把 `/api` 同源代理到 `127.0.0.1:3000`，让 SameSite 会话 Cookie 正常工作；仓库内的 `.env.development` 已配置 `VITE_API_BASE=/`。如需纯本地模式，可在 `.env.local` 中把该变量留空（内置 IELTS 词表 + 免费词典 API）。

## 部署

生产模式下由后端进程同时提供 API 与前端静态页面（同源），只需访问一个地址（默认 `http://localhost:3000`）。以下两种方式二选一。

账号会话按同站部署设计：生产环境应保持前后端同源（推荐）或至少同站。仅添加跨站 `FRONTEND_ORIGIN` 并不能让 `SameSite=Lax` Cookie 在第三方站点工作。若 HTTPS 在反向代理终止，必须把 `TRUST_PROXY` 设为真实代理跳数，确保服务端识别 HTTPS 并签发 `Secure` 会话 Cookie。

### 方式一：Node 直跑（任意 OS，Node 22.12–24.x）

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

镜像会完成前后端构建并以非 root 的 `node` 用户运行。应用端口只暴露给 Docker 内部网络，Caddy 负责 80/443、自动 HTTPS、压缩和访问日志。服务器部署前创建根目录 `.env`：

```dotenv
SITE_ADDRESS=vocab.example.com
FRONTEND_ORIGIN=https://vocab.example.com
REGISTRATION_ENABLED=false
```

确认 DNS 已指向服务器并开放 TCP 80/443、UDP 443 后执行 `docker compose up -d --build`。管理员初始化完成后再把 `REGISTRATION_ENABLED` 改为 `true` 并重建容器。停止使用 `docker compose down`；`docker compose down -v` 会一并删除数据库和证书数据卷，必须谨慎。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATABASE_FILE` | `./data/study-state.sqlite` | SQLite 数据库路径，相对 `backend/` 解析 |
| `DATA_FILE` | `./data/study-state.json` | 旧 JSON 数据源；仅在空数据库首次启动时导入一次 |
| `STATIC_DIR` | 构建后的 `frontend/dist`（Docker 内为 `/app/frontend/dist`） | 前端静态资源目录，设为空则关闭静态托管 |
| `FRONTEND_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | 额外允许的跨域来源（同源访问无需配置） |
| `TRUST_PROXY` | `0` | 前置反向代理的层数，用于正确识别客户端 IP（限流所需） |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | 注册/登录认证限流窗口（毫秒） |
| `LOGIN_RATE_LIMIT_MAX_REQUESTS` | `10` | 单 IP 每个认证限流窗口的最大尝试次数 |
| `REGISTRATION_ENABLED` | `true` | 是否允许公开注册；首次创建管理员时可设为 `false` |
| `MAX_WORDBOOKS_PER_CLIENT` | `50` | 单个客户端或账号可保存的词书总数（含回收站） |
| `MAX_WORDS_PER_CLIENT` | `50000` | 单个客户端或账号的单词总数 |
| `MAX_DRAFTS_PER_CLIENT` | `20` | 单个客户端或账号保留的导入草稿总数 |
| `WIKTAPI_BASE_URL` | `https://api.wiktapi.dev/v1/en/word` | 词典查询上游地址 |
| `WIKTAPI_TIMEOUT_MS` | `5000` | 在线词典请求超时（毫秒，最大 5000） |
| `DICTIONARY_FILE` | `../resources/dictionaries/generated/vocab.sqlite` | 构建生成的本地双语词典 |
| `DICTIONARY_REMOTE_FALLBACK` | `true` | 本地英文未命中时是否启用在线补充；服务器无法访问 WiktApi 时可设为 `false` |

### 管理员初始化

管理员权限保存在数据库角色中，公开注册只会创建普通用户，不再按用户名自动授权。Compose 部署后，在服务器本地准备一个权限为 `600` 的临时密码文件，然后把内容写入容器内的临时文件并执行：

```bash
# 密码不会出现在命令行参数或 shell 历史中
docker compose exec -T vacabweb sh -c 'umask 077; cat > /tmp/vacab-admin-password' < ./vacab-admin-password
docker compose exec -e ADMIN_PASSWORD_FILE=/tmp/vacab-admin-password vacabweb npm run admin -- create --username site-admin
docker compose exec vacabweb rm -f /tmp/vacab-admin-password
rm -f ./vacab-admin-password

# 将已有普通账号提升或降级
docker compose exec vacabweb npm run admin -- promote --username existing-user
docker compose exec vacabweb npm run admin -- demote --username existing-user
```

初始化期间可设置 `REGISTRATION_ENABLED=false`。密码临时文件应仅允许部署用户读取，并在命令完成后立即删除。若不使用 Docker，可在仓库根目录以 `ADMIN_PASSWORD_FILE=... npm run admin --prefix backend -- ...` 执行同一套命令。

### 数据备份

账号、会话、社区与学习数据保存在 `backend/data/study-state.sqlite`（Docker 部署时位于数据卷内）。运行中的服务使用 SQLite 在线备份 API。Compose 部署时先将备份写入数据卷，再复制到宿主机：

```bash
docker compose exec vacabweb npm run backup -- --output ./data/backups/vacab-2026-07-28.sqlite
mkdir -p ./backups
docker compose cp vacabweb:/app/backend/data/backups/vacab-2026-07-28.sqlite ./backups/
```

命令完成后会自动执行 `PRAGMA integrity_check`。请使用 cron/systemd timer 定时运行并设置异机保留策略；不要在运行中只复制主数据库文件而遗漏 WAL。恢复演练应在隔离目录启动服务并运行完整测试。旧版 `study-state.json` 只会在空数据库首次启动时导入。

## 校验

每个包内运行：

```bash
npm run typecheck
```

```bash
npm test
```

CI（`.github/workflows/ci.yml`）会在 push/PR 时对两个包分别执行 typecheck、测试与前端构建。

账号与社区的真实浏览器回归（需要系统 Chrome）：

```bash
npm ci
npm run build
npm run test:e2e:community-account
```

`normalizeWord` 在前后端各有一份刻意保持一致的实现，由 `resources/normalize-contract.json` 的共享用例表在两侧测试中锁定；修改任一侧请同步更新另一侧与该表。

## 更多文档

- [docs/architecture.md](docs/architecture.md) — 架构设计说明
- [docs/api.md](docs/api.md) — API 参考
- [docs/database.md](docs/database.md) — 数据库设计
- [docs/development.md](docs/development.md) — 开发与 E2E 流程
