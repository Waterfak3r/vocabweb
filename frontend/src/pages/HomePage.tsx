import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { WordResultCard } from '../components/word/WordResultCard'
import { EmptyState } from '../components/ui/EmptyState'
import { InkRule } from '../components/ui/InkRule'
import { Button } from '../components/ui/Button'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useWordLookup } from '../hooks/useWordLookup'
import { useWordSuggestions } from '../hooks/useWordSuggestions'
import { useStudySummary } from '../hooks/useStudySummary'
import { wordOfTheDay } from '../data/ieltsWords'
import { selectWordbookItems, useWordbook } from '../data/wordbookStore'
import type { WordEntry } from '../domain/types'
import { getEngagementApi, type PopularSearch } from '../data/engagementApi'

type StudyStepIconName = 'search' | 'bookmark' | 'practice'

const STUDY_STEP_ICON_PATHS: Record<StudyStepIconName, ReactNode> = {
  search: (
    <>
      <circle cx="10.25" cy="10.25" r="4.75" />
      <path d="m14 14 4.25 4.25" />
    </>
  ),
  bookmark: <path d="M7.25 4.75h9.5v14.5L12 16l-4.75 3.25z" />,
  practice: (
    <>
      <rect x="5.25" y="5.25" width="13.5" height="13.5" rx="1.5" />
      <path d="M9 10h6M9 14h6" />
    </>
  ),
}

function StudyStepIcon({ name }: { name: StudyStepIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {STUDY_STEP_ICON_PATHS[name]}
    </svg>
  )
}

export function HomePage() {
  useDocumentTitle('查词')

  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const [popular, setPopular] = useState<PopularSearch[]>([])
  const [popularState, setPopularState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [inputFocused, setInputFocused] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const today = wordOfTheDay()
  const wordbookItems = useWordbook(selectWordbookItems)
  const { summary, source: summarySource, isRefreshing, refresh } = useStudySummary(wordbookItems)
  const loadPopular = useCallback(async () => {
    const engagementApi = getEngagementApi()
    if (!engagementApi) {
      setPopular([])
      setPopularState('unavailable')
      return
    }
    try {
      setPopular(await engagementApi.listPopularSearches(7, 8))
      setPopularState('ready')
    } catch {
      setPopular([])
      setPopularState('unavailable')
    }
  }, [])
  const reportLookup = useCallback(
    (entry: WordEntry) => {
      void refresh()
      const engagementApi = getEngagementApi()
      if (engagementApi) {
        void engagementApi.reportSearch(entry.word).then(loadPopular).catch(() => undefined)
      }
    },
    [loadPopular, refresh],
  )
  const { state, lookup } = useWordLookup(undefined, reportLookup)
  const suggestionState = useWordSuggestions(inputValue)
  const suggestionsVisible =
    inputFocused && suggestionState.suggestions.length > 0
  const savedCount = summary.wordbookTotal
  const isRemote = summarySource === 'remote'
  const recent = summary.recent

  // Keep repeated lookups fast. The live result region still announces changes.
  useEffect(() => {
    if (state.status === 'success' || state.status === 'empty' || state.status === 'error') {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    }
  }, [state])

  useEffect(() => {
    setActiveSuggestion(-1)
  }, [suggestionState.suggestions])

  useEffect(() => {
    void loadPopular()
  }, [loadPopular])

  function runLookup(raw: string) {
    suggestionState.dismiss(raw)
    setActiveSuggestion(-1)
    const error = lookup(raw)
    setInputError(error ?? '')
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runLookup(inputValue)
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && suggestionsVisible) {
      event.preventDefault()
      suggestionState.dismiss()
      setActiveSuggestion(-1)
      return
    }
    if (event.key === 'ArrowDown' && suggestionsVisible) {
      event.preventDefault()
      setActiveSuggestion((current) =>
        current < suggestionState.suggestions.length - 1 ? current + 1 : 0,
      )
      return
    }
    if (event.key === 'ArrowUp' && suggestionsVisible) {
      event.preventDefault()
      setActiveSuggestion((current) =>
        current > 0 ? current - 1 : suggestionState.suggestions.length - 1,
      )
      return
    }
    if (event.key === 'Enter' && suggestionsVisible && activeSuggestion >= 0) {
      event.preventDefault()
      const selected = suggestionState.suggestions[activeSuggestion]
      if (selected) {
        setInputValue(selected.word)
        runLookup(selected.word)
      }
    }
  }

  return (
    <section className="page" aria-labelledby="home-title">
      <div className="home-lede">
        <div className="home-copy">
          <div className="home-title-row">
            <svg className="quill-mark" viewBox="0 0 48 56" aria-hidden="true">
              <path d="M40.5 3.5C27.2 7.5 15.6 18.6 11 34.7l-7 13.8 13.8-7C33.5 36.7 44.8 25 48.5 11.6c.8-2.9-1.4-8.9-8-8.1Z" />
              <path d="M9.5 40.5 24 42.2M13 34.4l7.1 7.2" />
              <path d="M16 46.1 6 50.5h13.3" />
            </svg>
            <div>
              <h1 className="home-title" id="home-title">
                定制你的专属单词学习
              </h1>
              <p className="home-path">查询 → 收藏 → 复习 → 听写</p>
              <p className="home-subtitle">结合你的习惯，建立一套自己的背词体系</p>
            </div>
          </div>
        </div>
        <svg className="book-sketch" viewBox="0 0 320 150" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.15">
            <path d="M28 45c46-15 79-3 125 30v59c-42-25-79-38-125-24z" />
            <path d="M292 45c-46-15-79-3-139 30v59c49-25 93-38 139-24z" />
            <path d="M153 75v59M36 53c41-10 72 2 117 28M284 53c-41-10-78 2-131 28" />
            <path d="M253 23 213 111l12 5 42-86zM213 111l-4 17 16-12" />
            <path d="M258 27l8 4M44 118c44-2 76 7 109 23M276 118c-47-2-82 7-123 23" />
          </g>
        </svg>
      </div>

      <div className="search-panel">
        <form className="search-form" onSubmit={handleSubmit} noValidate>
          <div className={`field ${inputError ? 'field-error-state' : ''}`}>
            <label className="field-label" htmlFor="word-query">
              英文单词或词组
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
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestionsVisible}
              aria-controls="word-query-suggestions"
              aria-activedescendant={
                suggestionsVisible && activeSuggestion >= 0
                  ? `word-query-suggestion-${activeSuggestion}`
                  : undefined
              }
              placeholder="例如 resilient 或 a lot of"
              value={inputValue}
              aria-invalid={Boolean(inputError)}
              aria-describedby={inputError ? 'word-query-error' : 'word-query-hint'}
              onChange={(event) => {
                suggestionState.resume()
                setInputValue(event.target.value)
                setActiveSuggestion(-1)
                if (inputError) setInputError('')
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={handleInputKeyDown}
            />
            <ul
              id="word-query-suggestions"
              className={`search-suggestions ${suggestionsVisible ? '' : 'search-suggestions-hidden'}`}
              role="listbox"
              aria-label="匹配的词条"
            >
              {suggestionState.suggestions.map((suggestion, index) => (
                <li
                  id={`word-query-suggestion-${index}`}
                  key={suggestion.word}
                  role="option"
                  aria-selected={activeSuggestion === index}
                  className={activeSuggestion === index ? 'active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => {
                    setInputValue(suggestion.word)
                    runLookup(suggestion.word)
                  }}
                >
                  <span>{suggestion.word}</span>
                  {suggestion.zhMeaning && <small>{suggestion.zhMeaning}</small>}
                </li>
              ))}
            </ul>
            {inputValue && (
              <button
                className="field-clear"
                type="button"
                aria-label="清空输入"
                onClick={() => {
                  setInputValue('')
                  setInputError('')
                  suggestionState.resume()
                  inputRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
            {inputError ? (
              <p className="field-error" id="word-query-error" role="alert">
                {inputError}
              </p>
            ) : (
              <p className="field-hint" id="word-query-hint">
                回车查询，可含空格、连字符或撇号
              </p>
            )}
          </div>
          <Button type="submit" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? '查询中…' : '查询'}
          </Button>
        </form>

        <div className="chip-row" aria-label="近 7 天热门搜索">
          <span className="chip-label" aria-hidden="true">♨&nbsp; 近 7 天热门</span>
          {popular.map(({ word, count }) => (
            <button
              key={word}
              type="button"
              className="chip"
              title={`近 7 天搜索 ${count} 次`}
              onClick={() => {
                setInputValue(word)
                runLookup(word)
              }}
            >
              {word}
            </button>
          ))}
          {popularState === 'loading' && <span className="chip-note" role="status">正在读取…</span>}
          {popularState === 'ready' && popular.length === 0 && <span className="chip-note">近 7 天暂无搜索记录</span>}
          {popularState === 'unavailable' && <span className="chip-note">热门搜索暂不可用</span>}
        </div>
      </div>

      <div className="home-dashboard">
        <div className="home-result" aria-live="polite">
          {state.status === 'idle' && (
            <>
              <InkRule label="今日词头" />
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
              title="词库里没有这个词条"
              body={`没有找到「${state.query}」。检查拼写，或换一个单词或词组试试。`}
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

        <aside className="study-sidebar" aria-label="学习概览">
          <section className="study-card progress-card">
            <h2>学习概览</h2>
            {isRefreshing && <span className="sr-only" role="status">正在同步学习记录</span>}
            <div className="progress-overview">
              {isRemote ? (
                <div className="wordbook-orb" aria-label={`共 ${summary.wordbookCount} 个单词本`}>
                  <strong>{summary.wordbookCount}</strong>
                  <span aria-hidden="true">词本</span>
                </div>
              ) : (
                <div className="wordbook-orb" aria-label={`个人词本共收录 ${savedCount} 个单词`}>
                  <strong>{savedCount}</strong>
                  <span aria-hidden="true">词本</span>
                </div>
              )}
              <dl className="study-stats">
                {isRemote && recent ? (
                  <>
                    <div><dt>待复习</dt><dd>{recent.reviewDue}</dd></div>
                    <div><dt>已掌握</dt><dd>{recent.mastered}</dd></div>
                    <div><dt>未学习</dt><dd>{recent.unstudied}</dd></div>
                  </>
                ) : (
                  <>
                    <div><dt>今日收藏</dt><dd>{summary.addedToday}</dd></div>
                    <div><dt>可复习词条</dt><dd>{summary.reviewDue}</dd></div>
                    <div><dt>可听写词条</dt><dd>{summary.dictationDue}</dd></div>
                  </>
                )}
              </dl>
            </div>
            {isRemote && recent && (
              <p className="study-recent">
                最近学习：<strong>「{recent.title}」</strong>
              </p>
            )}
          </section>

          <section className="study-card steps-card">
            <h2>学习步骤</h2>
            <ol className="study-steps">
              <li><a href="#word-query"><span className="study-step-icon"><StudyStepIcon name="search" /></span><span><strong>查询生词</strong><small>输入或粘贴你想查的生词</small></span></a></li>
              <li><Link to="/wordbook"><span className="study-step-icon"><StudyStepIcon name="bookmark" /></span><span><strong>收入词本</strong><small>收藏到你的个人词本</small></span></Link></li>
              <li><Link to="/flashcards"><span className="study-step-icon"><StudyStepIcon name="practice" /></span><span><strong>复习与巩固</strong><small>通过单词卡和听写强化记忆</small></span></Link></li>
            </ol>
          </section>
        </aside>
      </div>
    </section>
  )
}
