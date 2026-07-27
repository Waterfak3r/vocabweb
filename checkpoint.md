# 后端交接 Checkpoint

> 后端契约或持久化变更后同步更新；内容以当前代码和测试为准。

## 当前能力

- Express 5 + TypeScript（ESM），Node.js 20+。
- WiktApi 英语词典代理、本地中文释义补充、个人词本、导入、学习队列、熟练度阶梯与统计。
- 账号注册/登录/退出：密码使用带随机盐的 scrypt 记录；浏览器只保存随机会话 Cookie，数据库只保存令牌 SHA-256。
- 匿名数据会在注册或登录时合并进账号数据空间；有效会话决定实际 `clientId`，客户端请求头不能覆盖账号身份。
- 单词社区支持公开、邀请码、私密三档可见性，并在服务端执行作者、所有者和直达访问权限。
- 生产默认使用 SQLite 混合存储；旧 JSON 仅作为一次性迁移源。

## 关键文件

```text
backend/
├─ src/
│  ├─ app.ts                    # 路由、身份解析、CORS、Cookie、限流、错误响应
│  ├─ auth.ts                   # scrypt、会话令牌与 Cookie 工具
│  ├─ config.ts                 # 环境变量读取与边界校验
│  ├─ server.ts                 # 生产组合根，默认 SqliteStudyStore
│  ├─ study/
│  │  ├─ ladder.ts              # 状态迁移、熟练度与 DTO 纯函数
│  │  ├─ sqlite-store.ts        # SQLite schema、旧 JSON 导入、按行增量持久化
│  │  ├─ store.ts               # 领域操作、内存与 JSON 兼容 store
│  │  ├─ types.ts               # 账号、社区、词本和学习契约
│  │  └─ validation.ts          # HTTP 输入校验与规范化
│  └─ words/                    # 查询规范化、provider 与缓存
└─ test/
   ├─ auth-community.test.ts    # 认证、合并、授权与三档可见性
   ├─ auth-crypto.test.ts       # 密码、令牌与 Cookie
   ├─ sqlite-store.test.ts      # 迁移、增量写和关系约束
   └─ study.test.ts             # 词本、学习与社区主回归
```

## 身份与权限契约

- 匿名 API 需要合法的 `X-Vocab-Client-Id`。它只是匿名数据分区标识，不是账号凭据。
- 当会话有效时，服务端始终使用会话账号的 `clientId`；请求头中的其他值不会切换数据空间。
- 已归属账号的 `clientId` 在没有会话时返回 `401 AUTH_REQUIRED`，避免退出后或泄漏 ID 时继续访问账号数据。
- `POST /api/auth/register`
  - 用户名 2–20 位字母、数字、下划线、连字符或中文；密码 8–72 位。
  - `201 { username, clientId }`；用户名或匿名空间冲突为 `409`。
- `POST /api/auth/login`
  - `200 { username, clientId }`；错误凭据为 `401`；跨账号数据空间或活跃会话切号为 `409`。
  - 仅未归属账号的匿名空间可合并；重复登录不重复导入。
- `POST /api/auth/logout`：幂等返回 `204`，撤销当前会话并清 Cookie。
- `GET /api/auth/me`：有效会话返回账号 DTO，否则 `401`。

## 社区可见性

- `public`：进入广场列表，可按 ID 查看/收藏/加入；发布或切换到公开必须登录。
- `unlisted`：不进入广场，不能按 ID 直达加入，只能通过分享码导入；已收藏后转为邀请码的条目仍可在收藏中看到并取消。
- `private`：只在所有者的“我的上传”中可见；分享码也不能导入。
- 上传作者由有效会话注入，客户端请求体中的 `author` 不会进入解析结果。
- 非所有者更新或删除统一返回 `404`，避免资源枚举。
- 所有者上传 DTO 可返回 `sourceWordbookId`，公共卡片不暴露私有源词本。

## SQLite 持久化

- 默认路径：`DATABASE_FILE=./data/study-state.sqlite`。
- `users`、`sessions`、`catalog` 使用关系表和唯一约束；每个匿名/账号数据空间在 `clients` 中占一行 JSON。
- WAL、外键、busy timeout 已启用。BaseStore 在一次领域变更前后做 diff，SQLite 只 upsert/delete 变化行。
- `DATA_FILE=./data/study-state.json` 是旧版导入源。数据库为空且尚无迁移标记时导入一次；之后修改旧 JSON 不会覆盖 SQLite。
- 备份运行中的数据库时必须使用 SQLite 在线备份方式；简单文件复制应在服务停止后进行，并包含 WAL。

## 环境变量

- `PORT=3000`
- `DATABASE_FILE=./data/study-state.sqlite`
- `DATA_FILE=./data/study-state.json`
- `STATIC_DIR`：生产前端构建目录；为空则只提供 API。
- `FRONTEND_ORIGIN`：额外允许的浏览器来源，逗号分隔；同源生产请求自动允许。
- `TRUST_PROXY=0`：反向代理跳数，必须按真实拓扑配置。
- `LOGIN_RATE_LIMIT_WINDOW_MS=900000`
- `LOGIN_RATE_LIMIT_MAX_REQUESTS=10`
- `WORD_RATE_LIMIT_WINDOW_MS=60000`
- `WORD_RATE_LIMIT_MAX_REQUESTS=60`
- 其余词典与缓存变量见 `backend/.env.example`。

## 验证

在仓库根目录执行：

```bash
npm run build
npm test
```

单包检查：

```bash
npm run typecheck --prefix backend
npm test --prefix backend
npm run typecheck --prefix frontend
npm test --prefix frontend
```

当前后端回归覆盖 91 项，前端覆盖 57 项；根目录另有真实浏览器账号/社区流程脚本。

## 已知边界

- 登录、查词和变更限流是单进程内存状态，多实例部署应换成共享限流。
- SQLite 适合单机或单写进程；不要让多个容器并发挂载同一个普通文件卷写入。
- 当前账号是用户名 + 密码 MVP，尚无邮箱验证、找回密码、改密、注销账号与后台审核。
- 用户上传社区内容尚无举报/审核系统；公开部署前应补运营规则与内容治理。
