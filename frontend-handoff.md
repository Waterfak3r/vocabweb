# 前端交接文档（前端 → 后端对齐）

> 读者：接手后端实现的 GPT。
> 前置阅读：`checkpoint.md`（后端现状）。本文档定义前端重构后的结构、后端必须对齐的契约、以及两侧各自与联调的测试清单。
> 最后更新：2026-07-23（前后端第一阶段契约对齐并完成联调）。

---

## 0. 现状摘要

- **前端已全量重构**，代号「墨水词典 · Marginalia」。类型检查、21 项测试与生产构建通过。
- 查词仍为 local-first：本地 **52** 词 IELTS 精选秒回；配置 `VITE_API_BASE` 后其余词走后端，未配置时保留 dictionaryapi.dev 开发回退。
- **后端第一阶段已完成**：除 `GET /api/health` 外，已按本文档提供 `GET /api/words/:word`，含校验、稳定错误码、超时、缓存与限流。
- 前端后端接入仅发生在 `WordRepository` 数据边界；页面和词域组件没有因接入而修改。

---

## 1. 前端结构

### 1.1 技术栈

Vite 8 + React 19 + TypeScript 7 + react-router-dom 7 + Zustand 5。样式为手写 CSS tokens + 少量 CSS Modules（无 Tailwind/UI kit）。字体经 fontsource 自托管（Source Serif 4 / Source Sans 3 / IBM Plex Mono）。`package.json` 使用兼容版本范围，lockfile 锁定实际安装版本，无 `"latest"`。

### 1.2 目录树与职责

```text
frontend/src/
├─ main.tsx                    # 引导：字体 + 全局 CSS + BrowserRouter
├─ App.tsx                     # 仅路由表（壳是 AppShell）
│
├─ styles/                     # 全局样式，按层拆分，禁止再出现 1k+ 行巨石
│  ├─ tokens.css               # 设计 token：纸/墨/剑桥蓝、字阶、间距、圆角
│  ├─ reset.css / base.css     # 重置 + 元素默认
│  ├─ layout.css               # 壳：顶栏、单柱 ~46rem、页脚
│  ├─ utilities.css            # sr-only、marginal 批注、ink-rule、左缘竖线
│  ├─ components.css           # 共享原子：按钮/输入/徽标/空态/进度/快捷键
│  └─ word.css                 # 词域共享：词头签名、义项、单词本行、听写
│
├─ domain/                     # 纯领域，无依赖
│  ├─ types.ts                 # ★ WordEntry / WordMeaning / WordbookItem（契约见 §2）
│  ├─ normalize.ts             # normalizeWord / isValidWordQuery / wordbookId
│  └─ score.ts                 # 听写判分、错题提取、Fisher–Yates shuffle
│
├─ data/                       # 数据访问层（后端接入边界）
│  ├─ wordRepository.ts        # ★ WordRepository 接口 + LookupError
│  ├─ localIeltsRepository.ts  # Map 查询本地精选词
│  ├─ dictionaryApiRepository.ts # dictionaryapi.dev 客户端 + ★ mapper（参考实现）
│  ├─ backendWordRepository.ts # 后端客户端 + DTO/错误码运行时校验
│  ├─ compositeWordRepository.ts # local-first，未命中走 remote，错误向上抛
│  ├─ ieltsWords.ts            # 52 个 IELTS 高频词 + wordOfTheDay
│  ├─ wordbookStorage.ts       # Zustand JSON 适配、旧双重编码迁移与坏数据过滤
│  ├─ wordbookStore.ts         # Zustand persist：单词本 CRUD
│  └─ createRepositories.ts    # ★ 组合根 / factory（按 VITE_API_BASE 切换）
│
├─ lib/                        # 无业务工具
│  ├─ speech.ts                # Web Speech en-GB 朗读，cancel-safe
│  ├─ audio.ts                 # audioUrl 录音播放
│  ├─ storage.ts               # localStorage 安全读写（损坏返回 null）
│  ├─ keyboard.ts              # 快捷键匹配（输入框内忽略）
│  └─ cn.ts                    # className join
│
├─ hooks/
│  ├─ useWordLookup.ts         # 查词状态机：idle/loading/success/empty/error
│  ├─ usePronounce.ts          # audioUrl 优先，失败回退 Web Speech
│  ├─ useKeyboardShortcuts.ts  # 页面级快捷键注册
│  └─ useDocumentTitle.ts      # 中文页面标题
│
├─ components/
│  ├─ layout/                  # AppShell（skip-link+Outlet）、SiteHeader/Footer、PageHeader
│  ├─ ui/                      # 无业务原子：Button、IconButton、TextField、Badge(PosBadge)、
│  │                           #   EmptyState、ProgressBar、StatusMessage、InkRule
│  └─ word/                    # 词域组件：WordHeadword（签名元素）、MeaningList、
│                              #   PronounceButton、AddToWordbookButton、WordResultCard、
│                              #   WordbookList/Item、Flashcard（3D 翻面）、FlashcardControls、
│                              #   DictationPrompt、DictationSummary、ShortcutHint
│
├─ pages/                      # HomePage / WordbookPage / FlashcardsPage / DictationPage
└─ features/                   # 页面内会话逻辑（不进全局 store）
   ├─ flashcards/useFlashcardSession.ts  # shuffle 队列；掌握移除、不熟回队尾；须先翻面
   └─ dictation/useDictationSession.ts   # 逐题判分；结束可「再写一遍错词」
```

### 1.3 关键设计决定（后端不必改，但要理解边界）

| 决定 | 含义 |
|---|---|
| 全局状态只有单词本 | Zustand persist，key `vocab-ielts:wordbook:v1`；闪卡/听写会话是页面 hook，刷新即弃 |
| 查词二级仓库 | 本地 52 词秒回 + 离线兜底；未命中才打配置的后端或开发回退；网络错误进 error 态 |
| UI 只依赖 `domain/types.ts` | 组件从不接触 dictionaryapi.dev 原始结构，mapper 在 data 层边界 |
| id = 规范化词形 | `WordbookItem.id === normalizeWord(word)`（v1 单 lemma 唯一） |
| 英文义项 + 中文界面 | 词典数据保持英文（IELTS 学习场景），UI chrome 全中文；**不做机翻中义** |

### 1.4 路由

| 路径 | 页面 | 标题 |
|---|---|---|
| `/` | HomePage | 查词 |
| `/wordbook` | WordbookPage | 单词本 |
| `/flashcards` | FlashcardsPage | 单词卡 |
| `/dictation` | DictationPage | 听写 |
| `*` | → `/` | |

---

## 2. 数据契约（后端必须逐字段对齐）

前端 `WordEntry` 的字段名**就是** `GET /api/words/:word` 的响应 DTO。逐字段一致，包括可选字段语义。

```ts
// frontend/src/domain/types.ts（契约源头，后端以此为准）

type WordSource = 'local-ielts' | 'dictionary-api' | 'user' | 'backend'

type WordMeaning = {
  pos: string          // 小写全写："noun" | "verb" | "adjective" | …，前端自行缩写成 n./v./adj.
  definition: string   // 英文释义（不做中义）
  example?: string     // 英文例句，可缺省
}

type WordEntry = {
  word: string         // 规范化小写 lemma，如 "resilient"
  phonetic: string     // 含斜杠的展示形 "/rɪˈzɪliənt/"，无则空串 ""
  audioUrl?: string    // https 发音 mp3；无则缺省（前端回退 Web Speech）
  meanings: WordMeaning[]  // ≥1 条；上限 8 条（多义截断，保持界面安静）
  source: WordSource   // 后端产出时固定 "backend"
}

type WordbookItem = WordEntry & {
  id: string           // === normalizeWord(word)
  addedAt: string      // ISO-8601
}
```

### 规范化规则（`domain/normalize.ts`）

- `normalizeWord`：trim → 折叠连续空白 → 小写。
- 合法查询正则：`/^[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*$/`（字母为主体，允许内部连字符/撇号，如 `well-known`、`don't`）。
- 后端路由参数应做同样校验，非法词形直接 400，不要透传给上游 provider。

### 错误响应

沿用后端现有统一格式 `{ error: { code, message } }`（见 `app.ts` 的 `apiError`）。建议的错误码：

| 场景 | HTTP | code |
|---|---|---|
| 词形非法 | 400 | `INVALID_WORD` |
| 词典无此词 | 404 | `WORD_NOT_FOUND` |
| 上游 provider 超时/挂掉 | 502 或 504 | `UPSTREAM_ERROR` / `UPSTREAM_TIMEOUT` |
| 上游返回无法解析 | 502 | `UPSTREAM_PARSE_ERROR` |

> 前端现在的网络错误文案是兜底的；接后端后会把 `error.code` 映射为中文提示。**保持 code 稳定**，message 可自由。

---

## 3. 后端需要实现的 API

### 3.1 第一阶段（必须）：词典查询

```http
GET /api/words/:word
→ 200  WordEntry DTO（§2，source 固定 "backend"）
→ 400  { error: { code: "INVALID_WORD", ... } }
→ 404  { error: { code: "WORD_NOT_FOUND", ... } }
→ 502/504 上游失败
```

实现要求：

1. **Provider 封装**：`checkpoint.md` 的既定方向是 WiktApi。用独立 provider 模块封装上游，内部先映射到 `WordEntry` 再出参——**不要让上游结构泄漏到响应里**。映射语义可直接参考前端 `frontend/src/data/dictionaryApiRepository.ts` 中的 `mapDictionaryApiToWordEntry`（它就是契约的可执行参考实现）：
   - 取首个条目为主；word 规范化后必须过校验正则；
   - phonetic：顶层 `phonetic` 优先，否则第一个非空 `phonetics[].text`；
   - audioUrl：优先 URL 含 `en-gb` 的非空 `phonetics[].audio`；
   - meanings：扁平化 `{pos, definition, example?}`，滤掉空释义，**上限 8 条**；
   - 映射不出任何有效义项 → 视为 404。
2. **超时**：上游调用设超时（建议 ≤5s），映射为 504。
3. **缓存**：词典响应天然可缓存，进程内 Map 缓存即可起步（键=规范化词形）；顺带保护上游配额。
4. **限流**：简单 per-IP 限流即可，防滥用。
5. **CORS**：现有 `FRONTEND_ORIGIN` 机制不变。

### 3.2 第二阶段（可选）：单词本同步

前端单词本目前是 localStorage（Zustand persist）。要做账号/多端同步时：

```http
GET    /api/wordbook           → 200 WordbookItem[]
POST   /api/wordbook           → 201 WordbookItem（body: WordEntry；重复词幂等返回 200）
DELETE /api/wordbook/:id       → 204（id 即规范化词形）
```

契约仍是 §2 的 `WordbookItem`。账号体系未定，第二阶段再议。

---

## 4. 前端后端接入（已完成）

第一阶段已经按以下边界接入：

1. **`frontend/src/data/backendWordRepository.ts`**：实现 `WordRepository`，安全拼接 `${VITE_API_BASE}/api/words/${encodeURIComponent(word)}`；404 → null；稳定错误码映射为中文 `LookupError`；200 响应经过运行时 DTO 校验。
2. **`frontend/src/data/createRepositories.ts`**：始终保留 local-first；有 `VITE_API_BASE` 时使用「本地 52 词 → 后端」，未配置时使用「本地 52 词 → dictionaryapi.dev」。
3. **`frontend/.env.development` / `.env.example` / `vite-env.d.ts`**：提供并声明 `VITE_API_BASE`。开发默认走同源 `/api` 代理；个人覆盖可写入不提交的 `.env.local`。

前端环境变量：开发默认由 `frontend/.env.development` 设置 `VITE_API_BASE=/`，Vite 再把 `/api` 代理到 3000 端口。

**不变量**：页面/组件只 import `domain/types.ts` 与 store/repository 接口；第二阶段单词本云同步尚未实施，当前仍是 localStorage。

---

## 5. 测试

### 5.1 前端验证结果

自动化：`npm test`（21 项）✅、`npm run typecheck` ✅、`npm run build` ✅。

浏览器手动走查（dev server）：

| 流程 | 状态 |
|---|---|
| 查 `resilient`（本地命中）→ 来源「IELTS 精选」→ 不请求后端 | ✅ Chrome/CDP 已验证 |
| 查 `serendipity`（后端）→ 来源「词库」+ noun 义项 + 发音 | ✅ Chrome/CDP + 真实 WiktApi 已验证 |
| 非法输入（多词）→ 校验文案 | ✅ 已验证 |
| 收入 `serendipity` → 导航到单词本 → 整页刷新仍恢复 | ✅ Chrome/CDP 已验证 |
| 单词本筛选 / 移除 / 持久化 | ✅ Chrome/CDP 已验证 |
| 闪卡：翻面 → F/J 判定 → 不熟回队尾 → 完成小结 → 再来一轮 | ✅ Chrome/CDP 已验证 |
| 听写：自动播音 → 提交判分 → 对错反馈 → 小结 → 再写一遍错词 | ✅ Chrome/CDP 已验证 |
| 空单词本进闪卡/听写 → 空态 CTA | ✅ Chrome/CDP 已验证 |
| 停掉后端查非本地词 → 错误态 + 重试；本地词仍可查 | ✅ Chrome/CDP 已验证 |
| 键盘：空格翻面、`/` 无关、未翻面禁判、输入框内快捷键抑制；focus-visible | ✅ Chrome/CDP 已验证 |
| `prefers-reduced-motion`：取消 3D 翻面并近乎瞬时切换 | ✅ Chrome/CDP 已验证 |
| 四条主路由可进入；375px 无横向溢出 | ✅ Chrome/CDP 已验证 |

> 已引入 Vitest。现有测试覆盖 storage 迁移、normalize、score、后端 Repository DTO/错误映射、fetch 宿主绑定和组合根选择。

### 5.2 后端自动化测试（已实现，沿用 node:test 模式）

共 44 项测试通过；测试起随机端口，不增加额外 HTTP 测试依赖。

**契约测试（`GET /api/words/:word`）**

1. 命中（mock provider 返回固定 payload）→ 200；逐字段断言 DTO：`word` 小写、`phonetic` 串、`meanings` 非空且 ≤8、每条含 `pos/definition`、`source === "backend"`、**无上游多余字段泄漏**。
2. 词形非法（`GET /api/words/hello%20world`、数字、空）→ 400 `INVALID_WORD`，且**未调用** provider。
3. 上游「无此词」→ 404 `WORD_NOT_FOUND`。
4. 上游超时（mock 挂起）→ 504。
5. 上游 5xx / 非 JSON → 502。
6. 缓存：同一词连查两次，provider 只被调一次（如实现了缓存）。
7. CORS：允许来源带 `Access-Control-Allow-Origin`；不允许来源被拒。

**Provider mapper 单测**

- 多词性多义项扁平化、空释义过滤、8 条截断、en-gb 音频优先、无音频缺省、映射为空 → null。
- WiktApi `/definitions` 是义项与词性的权威来源；完整词条用于 IPA/HTTPS MP3，并允许发音数据失败时降级。

**回归**

- `GET /api/health`、404/400/500 统一错误格式（现有测试）不得被破坏。

### 5.3 前后端联调验收

1. `backend` 起 3000；前端使用仓库内 `.env.development` 的 `VITE_API_BASE=/`，由 Vite 同源代理 `/api`。
2. 查一个本地词（如 `resilient`）→ 命中本地，`source` 显示「IELTS 精选」，浏览器网络记录确认后端请求为 0。✅
3. 查一个非本地词（如 `serendipity`）→ 走后端，词条卡来源显示「词库」；浏览器网络记录确认请求一次。✅
4. 停掉后端再查非本地词 → 前端 error 态 + 重试按钮；本地词不受影响。
5. 收入单词本 → 刷新仍在（localStorage 未受切换影响）。✅
6. 四条主路由、空态、单词本、闪卡、听写、键盘、reduced-motion 与 375px 布局均已自动化浏览器走查。✅

---

## 6. 附：前端设计边界（后端无需关心，仅备查）

- 品牌：剑桥蓝 `#1B4F72` 唯一强调色；绿/锈红仅语义态；纸底 `#F3EDE3`。
- 唯一编排动效：闪卡 3D 翻面 420ms；`prefers-reduced-motion` 必须退化为瞬时切换。
- 文案全中文、主动短句；错误文案可执行（「重试」而非「抱歉」）。
- 当前未做：SM-2 间隔重复、多词短语查询、PWA；账号、匿名数据合并、云端 SQLite 同步和中文释义已落地。
