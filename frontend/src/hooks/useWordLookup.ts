import { useCallback, useEffect, useRef, useState } from 'react'
import { wordRepository } from '../data/createRepositories'
import { LookupError, type WordRepository } from '../data/wordRepository'
import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import type { LookupResult, WordEntry } from '../domain/types'

type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | LookupResult

export type UseWordLookup = {
  state: LookupState
  /** Validate + run a lookup. Returns the validation error, if any. */
  lookup: (raw: string) => string | null
  reset: () => void
}

export function useWordLookup(
  repo: WordRepository = wordRepository,
  onSuccess?: (entry: WordEntry) => void,
): UseWordLookup {
  const [state, setState] = useState<LookupState>({ status: 'idle' })
  const requestRef = useRef(0)

  const lookup = useCallback(
    (raw: string): string | null => {
      const query = normalizeWord(raw)

      if (!query) return '先输入一个英文单词。'
      if (!isValidWordQuery(query)) return '只接受单个英文单词，可含连字符或撇号。'

      const requestId = ++requestRef.current
      setState({ status: 'loading', query })

      repo
        .lookup(query)
        .then((entry) => {
          if (requestRef.current !== requestId) return
          if (entry) {
            setState({ status: 'success', entry })
            // Analytics must not be able to turn a successful lookup into an error.
            try {
              onSuccess?.(entry)
            } catch {
              // Keep dictionary lookup independent from study-record availability.
            }
            return
          }
          setState({ status: 'empty', query })
        })
        .catch((error: unknown) => {
          if (requestRef.current !== requestId) return
          const message =
            error instanceof LookupError
              ? error.message
              : '查询时出了点问题，请稍后重试。'
          const code = error instanceof LookupError ? error.code : 'unknown'
          setState({ status: 'error', query, message, code })
        })

      return null
    },
    [repo, onSuccess],
  )

  const reset = useCallback(() => {
    requestRef.current += 1
    setState({ status: 'idle' })
  }, [])

  // Drop any in-flight result when the component unmounts.
  useEffect(() => () => void (requestRef.current += 1), [])

  return { state, lookup, reset }
}
