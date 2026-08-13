import { WorkspaceApiError, type CatalogVisibility, type CatalogWordbook, type MyWordbook } from '../../data/workspaceApi'

export const MARKETPLACE_TITLE_MAX_LENGTH = 40
export const PUBLISH_EXAMS = ['IELTS', 'TOEFL', 'GRE', '高考', '四级', '六级', '考研']
export const PUBLISH_GOALS = ['写作', '阅读', '听力', '口语']
export const UPLOAD_LOGIN_HINT = '登录后才能上传和管理单词本'

export const VISIBILITY_OPTIONS: Array<{ value: CatalogVisibility; label: string; hint: string }> = [
  { value: 'public', label: '公开', hint: '所有人可在广场看到' },
  { value: 'unlisted', label: '邀请码', hint: '不进列表，凭分享码导入' },
  { value: 'private', label: '私密', hint: '仅自己可见' },
]

export const VISIBILITY_LABELS: Record<CatalogVisibility, string> = {
  public: '公开',
  unlisted: '邀请码',
  private: '私密',
}

export type PublishCatalogInput = {
  sourceWordbookId: string
  expectedHeadRevisionId?: string
  title: string
  description: string
  exams: string[]
  goals: string[]
  visibility: CatalogVisibility
  message?: string
}

export function marketplaceTitleError(value: string): string {
  const title = value.trim()
  if (!title) return '请填写在广场展示的词库名称。'
  return title.length > MARKETPLACE_TITLE_MAX_LENGTH
    ? `社区展示名称不能超过 ${MARKETPLACE_TITLE_MAX_LENGTH} 个字符。`
    : ''
}

/** A public upload with open suggestions cannot be made less visible safely. */
export function hasOpenVisibilityChanges(
  visibility: CatalogVisibility | undefined,
  openContributionCount: number | undefined,
): boolean {
  // Legacy catalog payloads omit visibility but are rendered as public entries.
  return (visibility === 'public' || visibility === undefined) && (openContributionCount ?? 0) > 0
}

export function isSnapshotSourceLocked(
  sourceWordbookId: string | undefined,
  wordbooks: readonly Pick<MyWordbook, 'id'>[],
): boolean {
  return Boolean(sourceWordbookId && wordbooks.some((book) => book.id === sourceWordbookId))
}

export function findPublishedUploadForWordbook<T extends CatalogWordbook>(
  uploads: readonly T[],
  wordbookId: string,
): T | undefined {
  const matches = uploads.filter((book) => book.sourceWordbookId === wordbookId)
  if (matches.length <= 1) return matches[0]
  return [...matches].sort((left, right) => (
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)
  ))[0]
}

// Prefer the structured API status; retain the message fallback for older
// injected repositories used by tests and local integrations.
export function isAuthRequiredError(error: unknown): boolean {
  return error instanceof WorkspaceApiError
    ? error.status === 401
    : error instanceof Error && (error.message.includes('(401)') || error.message.includes('AUTH_REQUIRED_FOR_PUBLIC'))
}
