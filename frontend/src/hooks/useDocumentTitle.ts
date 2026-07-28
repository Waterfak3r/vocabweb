import { useEffect } from 'react'

const BASE_TITLE = 'WeCreate Vocab'

export function useDocumentTitle(pageTitle?: string): void {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · WeCreate Vocab` : BASE_TITLE
  }, [pageTitle])
}
