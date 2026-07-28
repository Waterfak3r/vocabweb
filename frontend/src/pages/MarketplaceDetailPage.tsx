import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { getWorkspaceApi, type CatalogDetail } from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function MarketplaceDetailPage() {
  const { id = '' } = useParams()
  const api = getWorkspaceApi()
  const [book, setBook] = useState<CatalogDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  useDocumentTitle(book?.title ? `${book.title} · 单词广场` : '词本概况')

  const load = async () => {
    if (!api || !id) {
      setError('无法读取该词本。')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setBook(await api.getCatalog(id))
      setError('')
    } catch {
      setBook(null)
      setError('该词本不存在、不可见或暂时无法加载。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id])

  const words = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return book?.words ?? []
    return (book?.words ?? []).filter((entry) =>
      [entry.word, entry.phonetic, entry.zhMeaning, ...entry.meanings.flatMap((meaning) => [meaning.pos, meaning.definition])]
        .filter(Boolean).join(' ').toLowerCase().includes(normalized))
  }, [book?.words, query])

  async function toggleFavorite() {
    if (!api || !book) return
    try {
      const result = await api.toggleFavorite(book.id)
      setBook({ ...book, ...result })
    } catch {
      setMessage('收藏操作失败，请稍后重试。')
    }
  }

  async function join() {
    if (!api || !book || book.added) return
    try {
      const result = await api.addCatalog(book.id)
      setBook(await api.getCatalog(book.id))
      setMessage(result.created ? `已加入「${book.title}」。` : '该词本已在你的学习词本中。')
    } catch {
      setMessage('加入词本失败，请稍后重试。')
    }
  }

  if (loading) return <section className="market-detail-state"><EmptyState title="正在加载词本概况" body="正在读取作者和单词列表。" /></section>
  if (!book) return <section className="market-detail-state"><EmptyState title="无法打开词本" body={error} action={<Link to="/marketplace">返回单词广场</Link>} /></section>

  return <article className="market-detail-page">
    <Link className="market-detail-back" to="/marketplace">← 返回单词广场</Link>
    <header className="market-detail-hero">
      <div>
        <p className="marginal">{book.exams.concat(book.goals).join(' · ') || '共享词本'}</p>
        <h1>{book.title}</h1>
        <p>{book.description || '作者暂未填写简介。'}</p>
        <small>作者：{book.author} · 发布于 {new Date(book.createdAt).toLocaleDateString('zh-CN')}</small>
      </div>
      <div className="market-detail-actions">
        <Button variant="secondary" onClick={() => void toggleFavorite()}>{book.favorited ? '取消收藏' : '收藏'} · {book.favoriteCount}</Button>
        <Button disabled={book.added} onClick={() => void join()}>{book.added ? '已加入词本' : '加入词本'}</Button>
      </div>
    </header>
    {(message || error) && <p className="market-sync-note" role="status">{message || error}</p>}
    <section className="market-detail-metrics" aria-label="词本数据">
      <span><strong>{book.wordCount}</strong> 单词</span>
      <span><strong>{book.favoriteCount}</strong> 收藏</span>
      <span><strong>{book.uses}</strong> 人使用</span>
      <span><strong>{book.rating}</strong> 评分</span>
    </section>
    <section className="market-detail-words">
      <header><div><p className="marginal">词表概览</p><h2>全部单词</h2></div><label><span className="sr-only">搜索词表</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词或释义" /></label></header>
      <p className="market-detail-result">显示 {words.length} / {book.wordCount} 词</p>
      <div className="market-detail-word-list">
        {words.map((entry) => <article key={entry.word}>
          <div><strong>{entry.word}</strong><small>{entry.phonetic || '暂无音标'}</small></div>
          <p>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</p>
          <small>{entry.meanings.slice(0, 2).map((meaning) => `${meaning.pos} ${meaning.definition}`).join('；')}</small>
        </article>)}
        {!words.length && <p className="market-detail-empty">没有匹配的单词。</p>}
      </div>
    </section>
  </article>
}
