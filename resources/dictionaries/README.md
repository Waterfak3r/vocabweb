# 英语词典原始资源包

本目录保存的是为网站后续词典、查词与单词本功能准备的**来源清单、字段约定和极小样例**；它不是完整词典发行包。完整数据应在导入任务中按发布版本下载、校验、记录来源并写入独立的 staging 表，避免把不同许可证的文本混在无来源字段中。

调研日期：2026-07-26，接入状态更新于 2026-07-28。每个来源的机器可读信息见 [sources.json](./sources.json)，统一导入字段见 [schema/word-record.schema.json](./schema/word-record.schema.json)，可运行前端/后端格式验证的小样例见 [samples/](./samples/)。

## 当前生产导入策略

- Open English WordNet 2025 是英文义项首选，ECDICT 提供中文释义、音标与频率字段。
- 构建器可流式读取固定 dump 日期和 SHA-256 的 Kaikki/Wiktextract `JSONL.gz`；只导入 OEWN 未覆盖的英语多词词条，不覆盖或混合 OEWN 义项。
- `dictionary_meanings.source_id` 保留每条英文义项来源；构建元数据记录 OEWN/ECDICT 版本、Wiktextract dump 日期、校验值及各类记录数。
- 未配置 Wiktextract 文件时构建仍可完成，但元数据会明确写入 `not-imported`。WiktAPI 只作为运行时本地未命中的在线兜底。

构建离线词组补充时设置：

```text
WIKTEXTRACT_JSONL_GZ=<仓库外的固定快照路径>
WIKTEXTRACT_DUMP_DATE=YYYY-MM-DD
WIKTEXTRACT_SHA256=<64 位十六进制校验值>
```

## 建议采用的分层

| 层级 | 来源 | 用途 | 许可与上线判断 |
| --- | --- | --- | --- |
| 核心英文义项与语义关系 | Open English WordNet（OEWN） | 英文释义、词性、同义词集、上下位/反义等关系 | **CC BY 4.0**；可商用，展示与分发时保留署名、来源链接、许可证链接和修改说明。建议作为首个可上线的英文释义源。 |
| 中文释义与学习标签 | ECDICT | 英汉释义、音标、词形、考试/频率字段 | 仓库声明 **MIT**，但 README 披露其历史数据来自多种资料与抓取；在公开或商业全量再分发前必须复核数据血缘。可先用于开发/内部对照，不应以“权威考试大纲”名义展示其标签。 |
| 美式发音文本 | CMUdict | ARPAbet 音素串、发音变体 | BSD 风格、研究和商用不受限制；项目请求在使用/再分发说明中致谢。只提供文本音素，**不提供音频**。 |
| 词形与跨语言实体链接 | Wikidata Lexemes | lemma、词形、语法特征、sense 对应实体 | Lexeme 命名空间结构化数据为 **CC0**；很适合补词形与链接，释义覆盖并不完整。Commons 音频/图片另有逐文件许可，不可随数据一并视为 CC0。 |
| 长尾释义、词源、例句、译文 | English Wiktionary / Kaikki Wiktextract | 覆盖广的结构化词典补充 | 原始文本为 **CC BY-SA 4.0 + GFDL**；必须实现逐条来源、显著署名、许可证链接和同许可/透明副本义务后才可发布。不要与无 SA 许可的主数据做不可区分的合并。 |

推荐的最小可上线组合为 **OEWN + CMUdict + Wikidata Lexemes**。若需中文释义，先以 ECDICT 做可替换适配层，保留记录级来源；Wiktionary 仅在完成“来源页 + 署名链 + ShareAlike 策略”后接入。

## 来源、下载与风险

### 1. Open English WordNet（首选英文词典）

- 项目/下载页：[Open English WordNet](https://en-word.net/downloads)；源码：[globalwordnet/english-wordnet](https://github.com/globalwordnet/english-wordnet)。
- 归属：Open English Wordnet Community；项目说明其源自 Princeton WordNet。官方 2025 下载页提供 JSON、WN-LMF XML、RDF/Turtle 和 legacy WNDB 格式，JSON 压缩包约 9.5 MB。
- 许可：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；官方仓库明确声明为 CC-BY 4.0。
- 分发条件：保留作者/项目名称、来源 URL、许可证 URL；若有清洗、翻译或删改，在 `source_release` 中记录版本和修改说明。不要暗示原项目认可本站。
- 适用性：英文定义、词性、词义网络与关系图质量高，JSON/LMF 便于离线导入；但不含中文释义，也不是覆盖所有专有名词的百科词典。

### 2. ECDICT（英汉与学习字段，需血缘复核）

- 项目：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)；数据文件：[ecdict.csv](https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv)、[ecdict.mini.csv](https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.mini.csv)。
- 归属：仓库维护者 skywind3000；README 描述其聚合了早期词表、开源数据、语料统计与其他资料。
- 仓库许可：[MIT](https://github.com/skywind3000/ECDICT/blob/master/LICENSE)。
- 分发条件：保留 MIT 版权与许可文本。由于仓库未给出每条词义、抓取来源和考试/词频标签的逐条许可证明，公开再分发前应做单独的法务/来源确认；不能仅凭仓库顶层 MIT 推断所有上游内容均无约束。
- 适用性：直接 CSV，含 `translation`、`phonetic`、`exchange`、考试标签和词频，适合中文学习体验和筛选；质量、来源与标签时效需抽检。
- 特别风险：`collins`、`oxford` 等字段不等于取得对应词典/品牌授权；页面文案不得将其表述为官方认证或官方完整名单。

### 3. CMU Pronouncing Dictionary（发音文本）

- 项目：[cmusphinx/cmudict](https://github.com/cmusphinx/cmudict)；主数据：[cmudict.dict](https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict)。
- 归属：Carnegie Mellon University Speech Group；README 写明数据版权为 Carnegie Mellon University（1993–2014）。
- 许可/条件：[LICENSE](https://github.com/cmusphinx/cmudict/blob/master/LICENSE)；其 README 说明研究和商业使用不受限制，并请求使用或再分发时致谢来源。
- 适用性：北美英语 ARPAbet 音素、可直接做听辨/拼读或转 IPA 的输入；不是英式发音库、不是音频库，且存在缺词/不一致的已知限制。

### 4. Wikidata Lexemes（CC0 词形元数据）

- 项目：[Wikidata Lexicographical data](https://www.wikidata.org/wiki/Wikidata:Lexicographical_data)；下载说明：[Database download](https://www.wikidata.org/wiki/Wikidata:Database_download)；单条 API 示例：[L3354](https://www.wikidata.org/w/api.php?action=wbgetentities&ids=L3354&format=json)。
- 归属：Wikidata contributors / Wikimedia；Lexeme、Form、Sense 为结构化实体。
- 许可：Lexeme 命名空间的结构化数据为 [CC0](https://creativecommons.org/publicdomain/zero/1.0/)。
- 下载方式：少量/增量使用 Wikibase API；批量使用官方 JSON/RDF dump。官方说明 JSON/RDF 是稳定接口，完整 Wikidata dump 非常大，切勿为本项目直接下载全量。
- 适用性：lemma、复数/时态、词性、语法特征、sense 到 Wikidata Item 的映射。它不是完整英汉词典，英文字义覆盖不均。
- 特别风险：实体声明中的 Commons 音频、图片只是文件名/链接；媒体文件许可证需逐个查 Commons 描述页。

### 5. English Wiktionary 与 Kaikki/Wiktextract（高覆盖候选，条件接入）

- 官方 dump：[enwiktionary latest](https://dumps.wikimedia.org/enwiktionary/latest/)；版权页：[Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)；Wikimedia dump 许可说明：[legal](https://dumps.wikimedia.org/legal.html)。
- 结构化派生下载：[Kaikki raw Wiktextract data](https://kaikki.org/dictionary/rawdata.html)，由 Wiktextract 从英文 Wiktionary dump 抽取；它降低解析难度，但**不改变**上游内容许可。
- 归属：Wiktionary contributors；Kaikki/Wiktextract 为处理/分发通道，原始文字权利仍需遵循 Wiktionary 规则。
- 许可：Wiktionary 原始条目文本双重许可为 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 与 GFDL。条目可能还包含外部引用、图片或音频，应按条目/媒体的额外条件处理。
- 分发条件：显著归属 Wiktionary contributors、链接到条目/修订或透明文本、提供许可证链接；若发布改编内容，要满足 CC BY-SA 的同许可要求及相应 GFDL 条件。必须与 CC BY/MIT/CC0 数据保持可区分的来源记录。
- 适用性：释义、词源、例句、翻译、IPA 等最丰富；当前 Kaikki 英文结构化包体积很大（2026-07 页面标示压缩约 2.6 GB），因此只宜按需筛选/增量处理，不能直接纳入仓库。

### 6. Princeton WordNet 3.0（兼容性备选，不建议与 OEWN 同时为主源）

- 项目：[Princeton WordNet](https://wordnet.princeton.edu/)；许可与商业使用说明：[License and Commercial Use](https://wordnet.princeton.edu/license-and-commercial-use)。
- 归属：Princeton University。
- 许可：WordNet 3.0 允许免费使用、复制、修改、分发（含商用），但须在所有副本与修改中保留版权、声明和免责声明；不得将 Princeton 名称用于广告/宣传。
- 适用性：老旧系统 WNDB 兼容或需要稳定历史版本时使用。新开发应优先 OEWN，避免同一英文定义同时来自两者而造成冲突和难以署名。

## 统一字段与归因设计

完整 JSON Schema 位于 [schema/word-record.schema.json](./schema/word-record.schema.json)。无论数据来自何处，导入后每个可展示的词义、例句、音标和关系都至少要保留：

```text
source_id           # 对应 sources.json 的 id
source_record_id    # 上游 synset / CSV 行词头 / Lexeme id / 页面 revision 等
source_version      # 发布年份、git commit、dump 日期或 retrieval time
license             # 如 CC-BY-4.0 / CC-BY-SA-4.0 / MIT / CC0
attribution_text    # 可直接用于页面/来源页的署名文本
source_url          # 可回溯的项目、条目或修订 URL
imported_at         # 导入时间
content_hash        # 清洗前或规范化后内容的 SHA-256
```

建议将 `definition`、`translation`、`example`、`pronunciation`、`relation` 设计为有独立 `provenance` 的子记录，而不是覆盖到单个 `words` 表的同一列。这样能让 UI 显示“释义来源”“发音来源”，也能在移除单一来源时安全回滚。

### 字段映射建议

| 统一字段 | OEWN | ECDICT | CMUdict | Wikidata Lexeme | Wiktionary / Kaikki |
| --- | --- | --- | --- | --- | --- |
| `lemma` | `members[]` | `word` | 词头 | `lemmas` | `word` |
| `part_of_speech` | `partOfSpeech` | `pos` | 无 | `lexicalCategory` | `pos` |
| `definition` | `definition[]` | `definition` | 无 | `senses[].glosses` | `senses[].glosses` |
| `translation.zh` | 无 | `translation` | 无 | 仅部分多语 gloss | 翻译/中文数据需独立解析 |
| `pronunciation` | 发布格式可能含发音信息 | `phonetic` | ARPAbet | IPA/媒体声明可能存在 | 可能含 IPA/媒体 |
| `inflection` | 词汇/关系 | `exchange` | 无 | `forms[]` | forms/inflection |
| `relations` | synset relation | 无 | 无 | sense/实体关系 | semantic relations |

## 导入与上线流程

1. 在 `source_releases` 登记下载页面、精确版本/commit/dump 日期、文件 hash、许可和下载时间；不要只记录“latest”。
2. 下载到仓库外的临时或数据存储区，校验 hash 后导入 staging；本仓库只存清单、转换脚本和不超过测试需要的小样例。
3. 规范化词头（Unicode NFC、大小写搜索键、词形指向 lemma），但保留原文和原始 ID；不要用 ECDICT 的词义覆盖 OEWN 或 Wiktionary 的词义。
4. 通过 `source_id + source_record_id` 去重；不同来源相同文本仍保留多条 provenance，交由 UI 优先级选择。
5. 上线前自动生成 `/sources` 归属页，并在词条详情显示释义/音标来源。含 Wiktionary 内容时，额外提供所需的 CC BY-SA/GFDL 许可证、来源/修订链接与可取得的透明副本。
6. 对音频、图片、商标名、考试标签与第三方引文单独审核；它们不能因为“词条数据是开源”而自动获得可分发权利。

## 样例说明

`samples/` 下仅含 1–2 个词义或数行发音/CSV 记录，用于开发解析器和 provenance 测试；不是可供生产的词典。各样例的来源、提取时间和不应据此推断的权利范围见 [samples/README.md](./samples/README.md)。

本调研用于工程选型，不构成法律意见；产品公开发布、商业分发或把 CC BY-SA 内容与专有内容组合前，应由项目方按目标法域复核。
