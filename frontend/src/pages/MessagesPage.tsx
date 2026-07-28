import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { getEngagementApi, type Message } from '../data/engagementApi'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

function storedNickname() {
  try { return localStorage.getItem('vocab-message-nickname-v1') ?? '' } catch { return '' }
}

export function MessagesPage() {
  useDocumentTitle('留言板')
  const api = useMemo(() => getEngagementApi(), [])
  const { user, loading: authLoading } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [nickname, setNickname] = useState(storedNickname)
  const [contact, setContact] = useState('')
  const [replying, setReplying] = useState<Message>()
  const [editing, setEditing] = useState<Message>()
  const [busy, setBusy] = useState(false)
  const isAdmin = user?.capabilities.includes('messages.moderate') ?? false

  const load = useCallback(async (cursor?: string) => {
    if (!api) { setError('当前未连接服务器，留言板暂不可用。'); setLoading(false); return }
    try {
      const page = await api.listMessages(cursor)
      setMessages((current) => cursor ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      setError('')
      if (!cursor && user) void api.markMessagesRead()
        .then(() => window.dispatchEvent(new Event('vocab:messages-read')))
        .catch(() => undefined)
    } catch {
      setError('留言读取失败，请稍后重试。')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [api, user])

  useEffect(() => { void load() }, [load])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = content.trim()
    const guestName = nickname.trim()
    if (!api || !text || (!user && (guestName.length < 2 || guestName.length > 30))) return
    setBusy(true); setError('')
    try {
      if (!user) {
        try { localStorage.setItem('vocab-message-nickname-v1', guestName) } catch { /* Optional. */ }
      }
      await api.createMessage({ content: text, ...(!user ? { nickname: guestName } : {}), ...(contact.trim() ? { contact: contact.trim() } : {}), ...(replying ? { parentId: replying.id } : {}) })
      setContent(''); setReplying(undefined)
      await load()
    } catch {
      setError('留言发布失败，可能操作过于频繁，请稍后重试。')
    } finally { setBusy(false) }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!api || !editing?.content?.trim()) return
    setBusy(true)
    try {
      await api.editMessage(editing.id, editing.content.trim())
      setEditing(undefined)
      await load()
    } catch { setError('编辑失败；留言可能已超过 30 分钟编辑期限。') } finally { setBusy(false) }
  }

  async function remove(message: Message) {
    if (!api || !window.confirm('撤回这条留言？回复会保留。')) return
    try { await api.deleteMessage(message.id); await load() } catch { setError('撤回失败，请稍后重试。') }
  }

  async function moderate(message: Message, action: 'hide' | 'restore') {
    if (!api) return
    try { await api.moderateMessage(message.id, action); await load() } catch { setError('管理操作失败。') }
  }

  async function permanent(message: Message) {
    if (!api || !window.confirm('永久删除该留言及全部下级回复？此操作无法撤销。')) return
    try { await api.permanentlyDeleteMessage(message.id); await load() } catch { setError('永久删除失败。') }
  }

  return (
    <section className="messages-page" aria-labelledby="messages-title">
      <header className="messages-hero">
        <p className="marginal">COMMUNITY NOTES</p>
        <h1 id="messages-title">公开留言板</h1>
        <p>分享建议、问题或学习心得。保持友善，让每一次回复都有价值。</p>
      </header>

      <form className="message-composer" onSubmit={submit}>
        <div className="message-composer-heading">
          <strong>{replying ? `回复 ${replying.author}` : user ? `以 ${user.username} 留言` : '写下你的留言'}</strong>
          {replying && <button type="button" onClick={() => setReplying(undefined)}>取消回复</button>}
        </div>
        {!authLoading && !user && <label>昵称<input value={nickname} minLength={2} maxLength={30} onChange={(event) => setNickname(event.target.value)} placeholder="2–30 个字符" /></label>}
        <label>联系方式 <small>选填，仅站长可见</small><input value={contact} maxLength={200} onChange={(event) => setContact(event.target.value)} placeholder="邮箱、QQ 或其他联系方式" /></label>
        <label>
          <span className="sr-only">留言内容</span>
          <textarea value={content} maxLength={1000} rows={5} onChange={(event) => setContent(event.target.value)} placeholder={replying ? `回复 @${replying.author}` : '欢迎提出建议，也可以聊聊你的学习体验。'} />
        </label>
        <div className="message-composer-footer"><span>{content.length} / 1000</span><button type="submit" disabled={busy || !content.trim() || (!user && nickname.trim().length < 2)}>{busy ? '正在发布…' : replying ? '发布回复' : '发布留言'}</button></div>
      </form>

      {error && <p className="message-error" role="alert">{error}</p>}
      {loading ? <p className="message-loading">正在读取留言…</p> : messages.length ? (
        <div className="message-list">
          {messages.map((message) => (
            <article key={message.id} className={`message-item message-depth-${message.depth} status-${message.status}`}>
              <header><strong>{message.author}</strong>{message.replyTo && <span>回复 @{message.replyTo}</span>}<time dateTime={message.createdAt}>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>{message.edited && <small>已编辑</small>}</header>
              {message.status === 'active' ? <p>{message.content}</p> : <p className="message-tombstone">{message.status === 'deleted' ? '该留言已被作者删除' : '该内容已被管理员隐藏'}</p>}
              {isAdmin && message.contact && <p className="message-contact">联系方式：{message.contact}</p>}
              <footer>
                {message.status === 'active' && <button type="button" onClick={() => { setReplying(message); setEditing(undefined); document.querySelector<HTMLTextAreaElement>('.message-composer textarea')?.focus() }}>回复</button>}
                {message.canEdit && <button type="button" onClick={() => { setEditing({ ...message }); setReplying(undefined) }}>编辑</button>}
                {message.canDelete && <button type="button" onClick={() => void remove(message)}>删除</button>}
                {isAdmin && <>{message.status === 'hidden' ? <button type="button" onClick={() => void moderate(message, 'restore')}>恢复</button> : <button type="button" onClick={() => void moderate(message, 'hide')}>隐藏</button>}<button type="button" className="danger" onClick={() => void permanent(message)}>永久删除</button></>}
              </footer>
              {editing?.id === message.id && <form className="message-edit" onSubmit={saveEdit}><textarea value={editing.content ?? ''} maxLength={1000} rows={4} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /><div><button type="button" onClick={() => setEditing(undefined)}>取消</button><button type="submit" disabled={busy}>保存修改</button></div></form>}
            </article>
          ))}
        </div>
      ) : <div className="message-empty"><h2>还没有留言</h2><p>成为第一个在这里留下文字的人。</p></div>}
      {nextCursor && <button className="messages-more" type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void load(nextCursor) }}>{loadingMore ? '加载中…' : '加载更多留言'}</button>}
    </section>
  )
}
