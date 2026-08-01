import { Link, useLocation } from 'react-router'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function NotFoundPage() {
  useDocumentTitle('页面未找到')
  const location = useLocation()

  return (
    <section className="not-found-page" aria-labelledby="not-found-title">
      <div>
        <p className="marginal">地址无效</p>
        <h1 id="not-found-title">没有找到这个页面</h1>
        <p>地址“{location.pathname}”不存在，可能已经移动或输入有误。你的词本和学习记录没有受到影响。</p>
        <nav aria-label="页面未找到后的可选操作">
          <Link className="not-found-primary" to="/">返回首页</Link>
          <Link to="/wordbook">打开我的单词本</Link>
        </nav>
      </div>
      <p className="not-found-number" aria-hidden="true">404</p>
    </section>
  )
}
