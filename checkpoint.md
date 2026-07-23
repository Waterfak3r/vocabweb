# 后端交接 Checkpoint

> 每次后端工作完成后必须更新此文件，保持内容简短、准确，并与实际代码及接口一致。

## 职责边界

- `frontend/` 是独立 Vite/React 前端项目；前端依赖、源码、配置和构建产物均位于该目录。
- `backend/` 是独立 Node.js 后端项目；后端工作不得修改 `frontend/` 内的源码、配置或依赖。
- 根目录仅保留仓库级文件与交接文档；每次完成后端工作后必须同步更新本文件。
- 当前仅提供 HTTP API 基础设施。词典接入、持久化、账号和部署尚未实施。

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
│  ├─ app.ts       # Express 应用、中间件、路由和统一错误响应
│  ├─ config.ts    # 环境变量读取与校验
│  └─ server.ts    # 进程入口和端口监听
├─ test/
│  └─ app.test.ts  # API 自动化测试
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ tsconfig.build.json
```

## 现有接口契约

- `GET /api/health`
  - `200`: `{ "status": "ok", "service": "vacabweb-backend" }`
- 未匹配的路径
  - `404`: `{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }`
- 非法 JSON 请求体
  - `400`: `{ "error": { "code": "INVALID_JSON", "message": "Request body contains invalid JSON" } }`
- 未处理异常
  - `500`: `{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }`

## 环境变量

- `PORT`：监听端口，默认 `3000`，必须是 `1-65535` 的整数。
- `FRONTEND_ORIGIN`：允许跨域访问的前端来源，默认 `http://localhost:5173`；多个来源用英文逗号分隔。
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

## 已知问题

- 尚未接入真实词典数据，当前只有健康检查接口。
- 当前没有数据库、鉴权、速率限制或生产日志方案。

## 下一步

- 以独立 provider 封装 WiktApi，定义稳定的内部单词数据模型与查询接口。
- 为第三方超时、无结果及异常响应增加映射和测试。
