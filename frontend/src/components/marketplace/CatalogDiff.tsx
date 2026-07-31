import type { ReactNode } from 'react'
import type { CatalogDiffStats, CatalogWordChange } from '../../data/workspaceApi'
import type { WordEntry } from '../../domain/types'

type DiffField = {
  key: string
  label: string
  before: string
  after: string
}

const display = (value: string | undefined) => value?.trim() || '未填写'

function meaningsText(entry: WordEntry): string {
  if (!entry.meanings.length) return '未填写'
  return entry.meanings
    .map((meaning) => [
      meaning.pos,
      meaning.definition,
      meaning.example ? `例句：${meaning.example}` : '',
    ].filter(Boolean).join(' · '))
    .join('\n')
}

function fieldsOf(entry: WordEntry): Array<{ key: string; label: string; value: string }> {
  return [
    { key: 'word', label: '单词', value: display(entry.word) },
    { key: 'phonetic', label: '音标', value: display(entry.phonetic) },
    { key: 'zhMeaning', label: '中文释义', value: display(entry.zhMeaning) },
    { key: 'meanings', label: '英文释义', value: meaningsText(entry) },
    { key: 'audioUrl', label: '发音地址', value: display(entry.audioUrl) },
  ]
}

/** Exposed for UI tests so every review surface follows the same field-level rule. */
export function changedCatalogFields(before: WordEntry, after: WordEntry): DiffField[] {
  const oldFields = new Map(fieldsOf(before).map((field) => [field.key, field]))
  return fieldsOf(after).flatMap((field) => {
    const oldField = oldFields.get(field.key)
    return oldField && oldField.value !== field.value
      ? [{ key: field.key, label: field.label, before: oldField.value, after: field.value }]
      : []
  })
}

export function diffStats(changes: CatalogWordChange[]): CatalogDiffStats {
  const visible = visibleCatalogChanges(changes)
  const additions = visible.filter((change) => change.kind === 'add').length
  const deletions = visible.filter((change) => change.kind === 'delete').length
  const updates = visible.filter((change) => change.kind === 'update').length
  return { additions, deletions, updates, changedWords: visible.length }
}

function visibleCatalogChanges(changes: CatalogWordChange[]): CatalogWordChange[] {
  return changes.filter((change) => (
    change.kind !== 'update' || changedCatalogFields(change.before, change.after).length > 0
  ))
}

function EntryFields({ entry }: { entry: WordEntry }) {
  return (
    <dl className="catalog-diff-entry-fields">
      {fieldsOf(entry).map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ChangeFrame({
  change,
  label,
  children,
}: {
  change: CatalogWordChange
  label: string
  children: ReactNode
}) {
  return (
    <article
      className={`catalog-diff-change catalog-diff-change--${change.kind}`}
      aria-label={`${label.replace(/^[+\-±]\s*/, '')}词条：${change.key}`}
    >
      <header className="catalog-diff-change__header">
        <span className={`catalog-diff-badge catalog-diff-badge--${change.kind}`}>{label}</span>
        <h3>{change.key}</h3>
      </header>
      {children}
    </article>
  )
}

function ChangeItem({ change }: { change: CatalogWordChange }) {
  if (change.kind === 'add') {
    return (
      <ChangeFrame change={change} label="+ 新增">
        <div className="catalog-diff-side catalog-diff-side--after">
          <span className="sr-only">以下为新增内容</span>
          <EntryFields entry={change.after} />
        </div>
      </ChangeFrame>
    )
  }
  if (change.kind === 'delete') {
    return (
      <ChangeFrame change={change} label="- 删除">
        <div className="catalog-diff-side catalog-diff-side--before">
          <span className="sr-only">以下为删除内容</span>
          <EntryFields entry={change.before} />
        </div>
      </ChangeFrame>
    )
  }
  const fields = changedCatalogFields(change.before, change.after)
  return (
    <ChangeFrame change={change} label="± 修改">
      <dl className="catalog-diff-updates">
        {fields.map((field) => (
          <div className="catalog-diff-field" key={field.key}>
            <dt>{field.label}</dt>
            <dd className="catalog-diff-compare">
              <div className="catalog-diff-side catalog-diff-side--before">
                <span className="catalog-diff-side__label">- 旧值</span>
                <del>{field.before}</del>
              </div>
              <div className="catalog-diff-side catalog-diff-side--after">
                <span className="catalog-diff-side__label">+ 新值</span>
                <ins>{field.after}</ins>
              </div>
            </dd>
          </div>
        ))}
      </dl>
    </ChangeFrame>
  )
}

export function CatalogDiff({
  changes,
  emptyMessage = '没有词条变化。',
}: {
  changes: CatalogWordChange[]
  emptyMessage?: string
}) {
  const visibleChanges = visibleCatalogChanges(changes)
  const stats = diffStats(visibleChanges)
  if (!visibleChanges.length) return <p className="catalog-diff-empty">{emptyMessage}</p>
  return (
    <section className="catalog-diff" aria-label="词条变化">
      <p className="catalog-diff-summary" aria-label={`新增 ${stats.additions}，删除 ${stats.deletions}，修改 ${stats.updates}`}>
        <span className="catalog-diff-count catalog-diff-count--add">+{stats.additions}</span>
        <span className="catalog-diff-count catalog-diff-count--delete">-{stats.deletions}</span>
        <span>{stats.updates} 项修改</span>
      </p>
      <div className="catalog-diff-list">
        {visibleChanges.map((change, index) => <ChangeItem change={change} key={`${change.kind}:${change.key}:${index}`} />)}
      </div>
    </section>
  )
}
