import type { WordbookItem } from '../../domain/types'
import { Button } from '../ui/Button'

export type DictationSummaryProps = {
  total: number
  correct: number
  wrong: WordbookItem[]
  onRetryAll: () => void
  onRetryWrong: () => void
}

export function DictationSummary({
  total,
  correct,
  wrong,
  onRetryAll,
  onRetryWrong,
}: DictationSummaryProps) {
  return (
    <div className="dictation-summary">
      <p className="marginal">本轮结束</p>
      <p className="dictation-score">
        对 <strong>{correct}</strong> 题，共 {total} 题
      </p>

      {wrong.length > 0 && (
        <div className="dictation-wrong">
          <p className="marginal">错词</p>
          <ul className="dictation-wrong-list">
            {wrong.map((item) => (
              <li className="dictation-wrong-row" key={item.id}>
                <span className="dictation-wrong-word">{item.word}</span>
                {item.meanings[0] && (
                  <span className="dictation-wrong-gloss">
                    {item.meanings[0].definition}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dictation-summary-actions">
        {wrong.length > 0 && (
          <Button variant="primary" onClick={onRetryWrong}>
            再写一遍错词
          </Button>
        )}
        <Button variant={wrong.length > 0 ? 'secondary' : 'primary'} onClick={onRetryAll}>
          全部重来
        </Button>
      </div>
    </div>
  )
}
