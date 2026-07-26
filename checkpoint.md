# 后端交接 Checkpoint

> 每次后端工作完成后必须更新此文件，保持内容简短、准确，并与实际代码及接口一致。

## 职责边界

- `frontend/` 是独立 Vite/React 前端项目；前端依赖、源码、配置和构建产物均位于该目录。
- `backend/` 是独立 Node.js 后端项目；后端工作不得修改 `frontend/` 内的源码、配置或依赖。
- 根目录仅保留仓库级文件与交接文档；每次完成后端工作后必须同步更新本文件。
- 当前提供 HTTP API、WiktApi 英语词典查询，以及匿名隔离的共享词本、个人词本和学习工作台数据服务。学习数据落盘到本机 JSON；账号体系尚未实施。

## 技术栈

- Node.js 20+
- TypeScript（ESM、严格模式）
- Express 5、CORS、dotenv
- Node.js 内置测试运行器；测试直接启动随机端口，无额外 HTTP 测试依赖

## 目录结构

```text
vacabweb/
├─ frontend/          # 独立 Vite/React 前端项目
├─ backend/           # 独立 Node.js API 项目（结构如下）
├─ .gitignore         # 仓库级忽略规则
└─ checkpoint.md      # 后端交接与当前状态

backend/
├─ src/
│  ├─ app.ts                  # Express 应用、路由与统一错误响应
│  ├─ config.ts               # 环境变量读取与校验
│  ├─ server.ts               # 进程组合根和端口监听
│  ├─ http/rate-limit.ts      # 查词路由单进程 per-IP 限流
│  ├─ providers/wiktapi.ts    # WiktApi 客户端、运行时校验与 DTO 映射
│  ├─ study/
│  │  ├─ types.ts             # 广场、个人词本、学习事件与工作台契约
│  │  ├─ validation.ts        # HTTP 输入校验与规范化
│  │  └─ store.ts             # 可注入 store；内存测试与 JSON 原子持久化实现
│  └─ words/
│     ├─ normalize.ts         # 查询规范化与合法性校验
│     ├─ types.ts             # WordEntry 契约及 provider 错误
│     └─ word-service.ts      # 有界 TTL 成功缓存及并发去重
├─ test/
│  ├─ app.test.ts             # API 契约与回归测试
│  ├─ config.test.ts          # 配置测试
│  ├─ wiktapi.test.ts         # provider 与 mapper 测试
│  ├─ word-service.test.ts    # 缓存及并发去重测试
│  └─ study.test.ts           # 广场、词本、工作台及 JSON 持久化回归
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ tsconfig.build.json
```

## 现有接口契约

- `GET /api/health`
  - `200`: `{ "status": "ok", "service": "vacabweb-backend" }`
- `GET /api/words/:word`
  - `200`: `{ word, phonetic, audioUrl?, meanings, source: "backend" }`
  - `400 INVALID_WORD`：空词、非法词形或非法 URL 编码
  - `404 WORD_NOT_FOUND`：WiktApi 无此词或没有有效英文释义
  - `429 RATE_LIMITED`：超过当前进程的 per-IP 查词限额
  - `502 UPSTREAM_ERROR`：上游网络或非成功 HTTP 响应
  - `502 UPSTREAM_PARSE_ERROR`：上游响应无法解析或结构不合法
  - `504 UPSTREAM_TIMEOUT`：上游请求超时
- 词本/学习接口均要求 `X-Vocab-Client-Id` 请求头。前端首次以 `crypto.randomUUID()` 生成并保存在 localStorage；它只做匿名命名空间隔离，并非鉴权。
  - 新匿名客户端首次访问个人空间时自动初始化 6 本默认词本（主词本为 `my-writing-task-2` / IELTS Writing Task 2，含可学习词条），并默认收藏 IELTS 核心词汇与高考3500；因此队列、学习事件和工作台无需依赖前端本地示例数据。
  - `GET /api/catalog/wordbooks?q=&exam=&goal=&sort=`：广场搜索、筛选和 recommended/hot/newest/rating 排序；内置 7 本与广场对应的种子词本；详情为 `GET /api/catalog/wordbooks/:id`；`GET /api/catalog/favorites` 和 `GET /api/catalog/uploads/mine` 分别提供我的收藏与上传。
  - `POST /api/catalog/wordbooks/:id/favorite` 收藏切换；`POST /api/catalog/wordbooks/:id/add` 加入我的词本。
  - `POST /api/catalog/uploads` 上传 `{ title, description?, exams?, goals?, words? }`；`POST /api/catalog/imports` 以 `{ shareCode }` 导入。
  - `GET|POST /api/my/wordbooks`（回收站为 `?view=trash`）；`GET|DELETE /api/my/wordbooks/:id`；`POST /api/my/wordbooks/:id/restore`。
  - `GET /api/my/wordbooks/:id/words?status=new|learning|review|mastered` 返回词本队列。
  - `POST /api/study/events`：`new`、`flashcard` 或 `dictation` 均带 `wordbookId` 与 `word`；后两者分别带 `verdict` 或 `correct`。
  - `GET /api/study/dashboard/:wordbookId`：选中词本的进度、今日计划、最近活动、七日历、周统计与连续天数。
- 未匹配的路径
  - `404`: `{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }`
- 非法 JSON 请求体
  - `400`: `{ "error": { "code": "INVALID_JSON", "message": "Request body contains invalid JSON" } }`
- 不允许的 CORS 来源
  - `403`: `{ "error": { "code": "CORS_ORIGIN_DENIED", "message": "Origin is not allowed" } }`
- 未处理异常
  - `500`: `{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }`

## 环境变量

- `PORT`：监听端口，默认 `3000`，必须是 `1-65535` 的整数。
- `FRONTEND_ORIGIN`：允许跨域访问的前端来源，默认 `http://localhost:5173,http://127.0.0.1:5173`；多个来源用英文逗号分隔。
- `WIKTAPI_BASE_URL`：WiktApi 英语单词端点，默认 `https://api.wiktapi.dev/v1/en/word`。
- `WIKTAPI_TIMEOUT_MS`：上游超时，默认且最大 `5000`。
- `WORD_CACHE_TTL_MS` / `WORD_CACHE_MAX_ENTRIES`：成功响应缓存 TTL 与容量，默认 `3600000` / `1000`。
- `WORD_RATE_LIMIT_WINDOW_MS` / `WORD_RATE_LIMIT_MAX_REQUESTS`：查词限流窗口与次数，默认 `60000` / `60`。
- `DATA_FILE`：匿名词本与学习数据 JSON 路径，默认 `./data/study-state.json`；写入串行执行并用同目录临时文件原子替换。
- 读取既有 v2 `DATA_FILE` 时会非破坏性补齐缺失的内置 catalog 种子（同 ID 的已有记录、用户上传和客户端数据保持不变），并立即原子写回升级后的文件。
- 本地配置从 `.env.example` 复制到 `.env`；`.env` 不提交版本库。

## 运行与验证

在 `backend/` 目录执行：

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

## 关键决定

- 前后端依赖与构建完全分离，后端拥有独立 `package.json`。
- `app.ts` 不监听端口，便于自动化测试；只有 `server.ts` 启动服务。
- API 错误统一使用 `{ error: { code, message } }`，不向客户端泄露堆栈。
- JSON 请求体限制为 `100kb`；CORS 来源通过环境变量显式配置。
- 查询词按前端契约执行 trim、连续空白折叠和小写化；仅允许英文字母主体及内部连字符/撇号。
- WiktApi 使用 `?lang=en`；并行请求 `/definitions`（义项/POS 权威、必需）与完整词条（IPA/HTTPS MP3、可降级），共享最多 5 秒总预算。
- 运行时校验所有上游结构，聚合英文词性/释义并全局截断至 8 条。
- `phonetic` 非空时统一为 `/.../`；`audioUrl` 只输出 HTTPS 音频。
- 仅成功词条进入有界 TTL 进程内缓存；相同词的并发请求共享一次上游调用。
- 限流仅作用于查词路由，是单进程方案；未配置反向代理信任。

## 已知问题

- 缓存与限流均为单进程内存状态，多实例部署时不会共享。
- JSON store 仅适于单机/开发期；多实例、跨进程写入和高容量目录需迁移到数据库或共享存储。
- `X-Vocab-Client-Id` 不构成身份认证；清理浏览器存储或换客户端会得到新的匿名空间。共享上传还没有审核/权限管理。
- 部署到反向代理后，需要按实际代理拓扑审慎配置 Express `trust proxy`，否则客户端 IP 限流可能不准确。

## 下一步

- 前端按 `X-Vocab-Client-Id` 接入词本广场、我的词本和学习工作台；原 localStorage 单词本可迁移为首个个人词本。
- 确定部署拓扑后升级为数据库、增加真实认证/作者权限、共享缓存/限流与生产日志。
