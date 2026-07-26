# 小样例与来源说明

这些文件只为解析器、字段映射和页面归因测试准备，合计远小于任何完整上游发布包。它们均为 2026-07-26 从下列公开源读取后，手工缩小到必要字段/行的样例；没有下载或提交任何完整词典。

| 文件 | 来源与记录 | 许可/归因 |
| --- | --- | --- |
| `oewn-bank.sample.json` | [OEWN source YAML](https://raw.githubusercontent.com/globalwordnet/english-wordnet/main/src/yaml/noun.group.yaml) 中 `08437235-n`、`08479077-n` 两个 synset 的必要字段。 | CC BY 4.0；归因 “Open English Wordnet Community, CC BY 4.0”，见 [LICENSES.md](../LICENSES.md)。 |
| `ecdict-mini.sample.csv` | [ecdict.mini.csv](https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.mini.csv) 的表头与首五条数据。 | 上游仓库声明 MIT；样例仅用于开发。对完整数据公开再分发仍须遵守 [README 的血缘复核提示](../README.md#2-ecdict英汉与学习字段需血缘复核)。 |
| `cmudict.sample.txt` | [cmudict.dict](https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict) 的 10 条词头/ARPAbet 行。 | CMUdict LICENSE / BSD 风格；使用或再分发时标示 Carnegie Mellon University / CMUdict。 |
| `wikidata-lexeme-L3354.sample.json` | [Wikibase API](https://www.wikidata.org/w/api.php?action=wbgetentities&ids=L3354&format=json) 的 Lexeme `L3354`，删除了媒体字段与大部分声明，仅保留词形、senses 和 API revision。 | CC0 结构化 Lexeme 数据；媒体文件未包含，也不可由本样例推断媒体可用性。 |

样例中的 `provenance` 故意使用完整来源和许可证信息，生产导入必须保留同等或更细的记录级信息。
