import { useMemo, useState } from 'react'
import { PageHeader } from '../components/layout/PageHeader'
import { Button, ButtonLink } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { TextField } from '../components/ui/TextField'
import { WordbookList } from '../components/word/WordbookList'
import { selectWordbookItems, useWordbook } from '../data/wordbookStore'
import { normalizeWord } from '../domain/normalize'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export function WordbookPage() {
  useDocumentTitle('单词本')

  const items = useWordbook(selectWordbookItems)
  const remove = useWordbook((state) => state.remove)
  const [filter, setFilter] = useState('')

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    [items],
  )

  const query = normalizeWord(filter)
  const filtered = useMemo(() => {
    if (!query) return sorted
    return sorted.filter(
      (item) =>
        item.word.includes(query) ||
        item.meanings.some((m) => m.definition.toLowerCase().includes(query)),
    )
  }, [sorted, query])

  return (
    <section className="page" aria-labelledby="wordbook-title">
      <PageHeader
        eyebrow="单词本"
        title="我的单词本"
        aside={`${items.length} 词`}
      />

      {items.length === 0 ? (
        <EmptyState
          title="单词本还是空的"
          body="查到生词后点「收入单词本」，它会出现在这里。"
          action={
            <ButtonLink to="/">去查词</ButtonLink>
          }
        />
      ) : (
        <>
          <div className="wordbook-toolbar">
            <TextField
              label="筛选单词本"
              value={filter}
              onChange={setFilter}
              placeholder="单词或释义关键词"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="wordbook-toolbar-actions">
              <ButtonLink to="/flashcards" variant="secondary">
                单词卡
              </ButtonLink>
              <ButtonLink to="/dictation" variant="secondary">
                听写
              </ButtonLink>
            </div>
          </div>

          <p className="wordbook-meta" role="status">
            显示 {filtered.length} / {items.length}
          </p>

          {filtered.length === 0 ? (
            <EmptyState
              title="没有匹配的词"
              body="换个关键词，或清除筛选。"
              action={
                <Button variant="secondary" onClick={() => setFilter('')}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <WordbookList items={filtered} onRemove={remove} />
          )}
        </>
      )}
    </section>
  )
}
