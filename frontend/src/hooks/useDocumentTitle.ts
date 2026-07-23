import { useEffect } from 'react'

const BASE_TITLE = '墨水词典 · Vocab IELTS'

export function useDocumentTitle(pageTitle?: string): void {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · Vocab IELTS` : BASE_TITLE
  }, [pageTitle])
}
