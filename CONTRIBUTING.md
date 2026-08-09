# 参与贡献

欢迎提交 issue 与 pull request。这是本地优先的背单词应用，前后端均为独立 npm 包，开发和验证流程已经固化在 CI 与本地脚本里。

## 从哪里开始

- 环境准备、本地开发、构建与 E2E 流程：见 [docs/development.md](docs/development.md)
- 架构设计与组件边界：见 [docs/architecture.md](docs/architecture.md)
- API 与数据库契约：见 [docs/api.md](docs/api.md) 与 [docs/database.md](docs/database.md)

## 基本约定

- **前后端解耦**：前端只消费 `frontend/src/data/` 中的类型化 API 客户端，后端只依赖 `backend/src/study/types.ts` 定义的领域契约；改动边界前先读架构文档。
- **内容寻址去重**：单词内容通过内容哈希在 `dictionary_entries` 中只存一份，词书、导入草稿与账号导出共享该字典条目。新增存储路径必须复用同一套内容寻址，不要复制完整词条。
- **双端一致的 `normalizeWord`**：前后端各有一份刻意保持一致的实现，由 `resources/normalize-contract.json` 的共享用例表在两侧测试中锁定。修改任一侧必须同步另一侧与该表。
- **提交前自检**：在两个包内分别运行 `npm run typecheck` 与 `npm test`；改动会影响 CI（`.github/workflows/ci.yml`）中 matrix 检查与容器冒烟测试。

## 提交

- 保持提交信息简洁、描述清楚动机。
- 涉及前后端任意一侧的行为变更，请在 PR 描述中说明影响与验证方式。

## 问题反馈

- 建议先搜索现有 issue，避免重复。
- 描述问题时尽量包含复现步骤、期望行为与实际行为，以及相关环境（浏览器版本、Node 版本、部署方式）。
