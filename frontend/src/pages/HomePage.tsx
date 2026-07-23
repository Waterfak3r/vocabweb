import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WordResultCard } from '../components/word/WordResultCard'
import { EmptyState } from '../components/ui/EmptyState'
import { InkRule } from '../components/ui/InkRule'
import { Button } from '../components/ui/Button'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useWordLookup } from '../hooks/useWordLookup'
import { IELTS_WORDS, wordOfTheDay } from '../data/ieltsWords'

const QUICK_CHIPS = ['ubiquitous', 'exacerbate', 'paradigm', 'viable', 'scrutinise', 'inevitable']

export function HomePage() {
  useDocumentTitle('查词')

  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const { state, lookup } = useWordLookup()
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const today = wordOfTheDay()

  // Focus the result once it lands, so screen readers announce it.
  useEffect(() => {
    if (state.status === 'success' || state.status === 'empty' || state.status === 'error') {
      resultRef.current?.focus({ preventScroll: false })
    }
  }, [state])

  function runLookup(raw: string) {
    const error = lookup(raw)
    setInputError(error ?? '')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runLookup(inputValue)
  }

  return (
    <section className="page" aria-labelledby="home-title">
      <div className="home-lede">
        <p className="marginal">查词</p>
        <h1 className="home-title" id="home-title">
          把生词写进自己的词典
        </h1>
        <p className="home-path">查询 → 收藏 → 复习 → 听写</p>
      </div>

      <div className="search-panel">
        <form className="search-form" onSubmit={handleSubmit} noValidate>
          <div className={`field ${inputError ? 'field-error-state' : ''}`}>
            <label className="field-label" htmlFor="word-query">
              英文单词
            </label>
            <input
              ref={inputRef}
              id="word-query"
              className="field-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="例如 resilient"
              value={inputValue}
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? 'word-query-error' : 'word-query-hint'}
              onChange={(event) => {
                setInputValue(event.target.value)
                if (inputError) setInputError('')
              }}
            />
            {inputError ? (
              <p className="field-error" id="word-query-error" role="alert">
                {inputError}
              </p>
            ) : (
              <p className="field-hint" id="word-query-hint">
                回车查询，可含连字符或撇号
              </p>
            )}
          </div>
          <Button type="submit" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? '查询中…' : '查询'}
          </Button>
        </form>

        <div className="chip-row" aria-label="IELTS 高频词，点一下即查">
          {QUICK_CHIPS.map((word) => (
            <button
              key={word}
              type="button"
              className="chip"
              onClick={() => {
                setInputValue(word)
                runLookup(word)
              }}
            >
              {word}
            </button>
          ))}
        </div>
      </div>

      <div ref={resultRef} tabIndex={-1} style={{ outline: 'none' }}>
        {state.status === 'idle' && (
          <>
            <InkRule label="今日词头" />
            <p className="word-of-day-note">先看一个 IELTS 常用词</p>
            <WordResultCard entry={today} />
          </>
        )}

        {state.status === 'loading' && (
          <p className="search-loading" role="status">
            正在翻词典…
          </p>
        )}

        {state.status === 'success' && (
          <>
            <InkRule label="词条" />
            <WordResultCard entry={state.entry} />
          </>
        )}

        {state.status === 'empty' && (
          <EmptyState
            title="词库里没有这个词"
            body={`没有找到「${state.query}」。检查拼写，或换一个词试试。`}
          />
        )}

        {state.status === 'error' && (
          <EmptyState
            title="暂时查不到"
            body={state.message}
            action={
              <Button variant="secondary" onClick={() => runLookup(state.query)}>
                重试
              </Button>
            }
          />
        )}
      </div>

      <p className="marginal" aria-hidden="true">
        词表收录 {IELTS_WORDS.length} 个 IELTS 高频词，其余交给在线词典
      </p>
    </section>
  )
}
