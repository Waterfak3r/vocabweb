import type { FormEvent } from 'react'
import type { StudyDisplayPreferences } from '../../data/studyPreferences'
import type { DictationGrade, WordbookItem } from '../../domain/types'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
import { preferredMeanings } from './Flashcard'
import { MeaningList } from './MeaningList'
import { PronounceButton } from './PronounceButton'

export type DictationPromptProps = {
  item: WordbookItem
  answer: string
  onAnswerChange: (value: string) => void
  onSubmit: () => void
  onNext: () => void
  onPlay: () => void
  phase: 'prompt' | 'feedback'
  grade: DictationGrade | null
  error?: string
  isLast: boolean
  preferences?: StudyDisplayPreferences & {
    underlineMistakes?: boolean
  }
}

export function spellingCharacters(given: string, expected: string) {
  return Array.from(given).map((character, index) => ({
    character,
    incorrect: character.toLocaleLowerCase() !== Array.from(expected)[index]?.toLocaleLowerCase(),
  }))
}

export function DictationPrompt({
  item,
  answer,
  onAnswerChange,
  onSubmit,
  onNext,
  onPlay,
  phase,
  grade,
  error,
  isLast,
  preferences = {
    meaningPreference: 'zh',
    showExamples: true,
    showPhonetic: true,
    underlineMistakes: true,
  },
}: DictationPromptProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase === 'prompt') onSubmit()
    else onNext()
  }

  return (
    <form className="dictation" onSubmit={handleSubmit} noValidate>
      <div className="dictation-hear">
        <p className="marginal">听发音，写下单词</p>
        <div className="dictation-play">
          <PronounceButton
            word={item.word}
            audioUrl={item.audioUrl}
            rate={0.78}
            label={`播放第 ${item.word} 题发音`}
          />
          <Button variant="secondary" size="sm" onClick={onPlay}>
            再播一次
          </Button>
        </div>
      </div>

      <TextField
        label="你的拼写"
        mono
        value={answer}
        onChange={onAnswerChange}
        error={error}
        placeholder="输入听到的单词"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={phase === 'feedback'}
        autoFocus
      />

      {phase === 'prompt' ? (
        <div className="dictation-actions">
          <Button type="submit">提交</Button>
        </div>
      ) : (
        <div className={`dictation-feedback ${grade === 'correct' ? 'edge-success' : 'edge-danger'}`}>
          {grade === 'correct' ? (
            <p className="dictation-verdict dictation-verdict-correct">拼写正确</p>
          ) : (
            <>
              <p className="dictation-verdict">拼写不对</p>
              <p className="dictation-given">
                你写了{' '}
                <span className={`dictation-given-word${preferences.underlineMistakes ? ' show-mistakes' : ''}`}>
                  {preferences.underlineMistakes
                    ? spellingCharacters(answer, item.word).map(({ character, incorrect }, index) => (
                        <span className={incorrect ? 'incorrect-letter' : ''} key={`${character}-${index}`}>
                          {character}
                        </span>
                      ))
                    : answer}
                </span>
              </p>
              <p className="dictation-correct">
                正确拼写 <span className="dictation-correct-word">{item.word}</span>
              </p>
            </>
          )}
          <div className="dictation-answer-details">
            {preferences.showPhonetic && item.phonetic && <p className="dictation-answer-phonetic">{item.phonetic}</p>}
            <MeaningList
              meanings={preferredMeanings(item, preferences.meaningPreference)}
              showExamples={preferences.showExamples}
            />
          </div>
          <div className="dictation-actions">
            <Button type="submit">{isLast ? '看结果' : '下一题'}</Button>
          </div>
        </div>
      )}
    </form>
  )
}
