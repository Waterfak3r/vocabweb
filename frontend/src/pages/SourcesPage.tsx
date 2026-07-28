import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function SourcesPage() {
  useDocumentTitle('词典来源')
  return (
    <section className="sources-page" aria-labelledby="sources-title">
      <p className="marginal">DICTIONARY SOURCES</p>
      <h1 id="sources-title">词典来源与许可</h1>
      <p>本站将不同来源的数据分开保存和标注；清洗、格式转换和展示裁剪不代表原项目对本站的认可。</p>
      <article>
        <h2>Open English WordNet 2025</h2>
        <p>用于本地英文释义，版本固定为 2025 Edition。数据由 Open English Wordnet Community 提供，采用 CC BY 4.0。</p>
        <a href="https://en-word.net/" target="_blank" rel="noreferrer">访问项目与许可证</a>
      </article>
      <article>
        <h2>ECDICT</h2>
        <p>用于中文释义、音标和学习标签。仓库声明采用 MIT；考试标签用于学习整理，不代表考试机构官方大纲。</p>
        <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noreferrer">访问项目与许可证</a>
      </article>
      <article>
        <h2>WiktAPI / Wiktionary</h2>
        <p>仅在本地英文义项未命中时作为在线补充。相关词条文本遵循 Wiktionary 的 CC BY-SA 4.0 / GFDL 条款。</p>
        <a href="https://wiktapi.dev/" target="_blank" rel="noreferrer">访问在线服务</a>
      </article>
    </section>
  )
}
