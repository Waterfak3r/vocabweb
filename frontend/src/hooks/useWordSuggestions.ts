import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeWord } from '../domain/normalize'
import {
  wordSuggestionRepository,
} from '../data/createRepositories'
import type {
  WordSuggestion,
  WordSuggestionRepository,
} from '../data/wordSuggestionRepository'

type SuggestionState = {
  suggestions: WordSuggestion[]
  status: 'idle' | 'loading' | 'ready'
}

export function useWordSuggestions(
  rawQuery: string,
  repository: WordSuggestionRepository | null = wordSuggestionRepository,
) {
  const [state, setState] = useState<SuggestionState>({
    suggestions: [],
    status: 'idle',
  })
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const requestRef = useRef(0)

  const dismiss = useCallback((value = rawQuery) => {
    requestRef.current += 1
    setDismissedFor(normalizeWord(value))
    setState({ suggestions: [], status: 'idle' })
  }, [rawQuery])

  const resume = useCallback(() => {
    setDismissedFor(null)
  }, [])

  useEffect(() => {
    const trimmed = rawQuery.trim().replace(/\s+/g, ' ')
    const query = /^[\p{Script=Han}\s]+$/u.test(trimmed) ? trimmed : normalizeWord(trimmed)
    const requestId = ++requestRef.current
    if (!repository || query.length < 2 || query === dismissedFor) {
      setState({ suggestions: [], status: 'idle' })
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setState({ suggestions: [], status: 'loading' })
      repository.suggest(query, 8, controller.signal)
        .then((suggestions) => {
          if (requestRef.current !== requestId) return
          setState({ suggestions, status: 'ready' })
        })
        .catch(() => {
          if (requestRef.current !== requestId || controller.signal.aborted) return
          setState({ suggestions: [], status: 'ready' })
        })
    }, 200)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [dismissedFor, rawQuery, repository])

  return { ...state, dismiss, resume }
}
