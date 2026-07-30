import { useEffect, useId, useRef, type FormEvent } from 'react'
import type { DictationDisplayPreferences } from '../../data/studyPreferences'
import { selectPreferredMeanings } from '../../domain/meaningSelection'
import type { DictationGrade, WordbookItem } from '../../domain/types'
import { Button } from '../ui/Button'
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
  currentStreak?: number
  requiredStreak?: number
  preferences?: DictationDisplayPreferences
}

export function spellingCharacters(given: string, expected: string) {
  return Array.from(given).map((character, index) => ({
    character,
    incorrect: character.toLocaleLowerCase() !== Array.from(expected)[index]?.toLocaleLowerCase(),
  }))
}

export function characterMask(word: string) {
  return Array.from(word).map((character) => /[a-z]/i.test(character) ? '□' : character).join('')
}

function DictationSpellingField({
  value,
  expected,
  onChange,
  error,
  readOnly,
  underlineMistakes,
  inputRef,
}: {
  value: string
  expected: string
  onChange: (value: string) => void
  error?: string
  readOnly: boolean
  underlineMistakes: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const id = useId()
  const errorId = `${id}-error`
  const live = !readOnly && underlineMistakes && value.length > 0
  return (
    <div className={`field ${error ? 'field-error-state' : ''}`}>
      <label className="field-label" htmlFor={id}>你的拼写</label>
      <div className={`dictation-live-input ${live ? 'is-live' : ''}`}>
        {live && (
          <span className="dictation-input-overlay" aria-hidden="true">
            {spellingCharacters(value, expected).map(({ character, incorrect }, index) => (
              <span className={incorrect ? 'incorrect-letter' : ''} key={`${character}-${index}`}>
                {character}
              </span>
            ))}
          </span>
        )}
        <input
          id={id}
          ref={inputRef}
          className="field-input field-input-mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          placeholder="输入听到的单词"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          readOnly={readOnly}
          autoFocus
        />
      </div>
      {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
    </div>
  )
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
  currentStreak = 0,
  requiredStreak = 3,
  preferences = {
    meaningPreference: 'zh',
    showExamples: true,
    showPhonetic: false,
    underlineMistakes: true,
    autoPlayAudio: true,
    showMeaning: false,
    showCharacterMask: true,
  },
}: DictationPromptProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // The same input is reused across cards, so autoFocus only fires once;
  // refocus whenever a new card starts answering so Enter keeps working.
  useEffect(() => {
    if (phase === 'prompt') inputRef.current?.focus()
  }, [phase, item.id])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase === 'prompt') onSubmit()
    else onNext()
  }

  return (
    <form className="dictation" onSubmit={handleSubmit} noValidate>
      <div className="dictation-hear">
        <p className="marginal">听发音，写下单词</p>
        <p className="dictation-streak" aria-live="polite">连续正确 {currentStreak} / {requiredStreak}</p>
        <div className="dictation-play">
          <PronounceButton
            word={item.word}
            rate={0.78}
            label={`播放第 ${item.word} 题发音`}
          />
          <Button variant="secondary" size="sm" onClick={onPlay}>
            再播一次
          </Button>
        </div>
        {(preferences.showPhonetic || preferences.showMeaning) && (
          <div className="dictation-prompt-hints">
            {preferences.showPhonetic && item.phonetic && <p className="dictation-answer-phonetic">{item.phonetic}</p>}
            {preferences.showMeaning && (
              <MeaningList
                meanings={selectPreferredMeanings(item, preferences.meaningPreference)}
                showExamples={preferences.showExamples}
              />
            )}
          </div>
        )}
        {phase === 'prompt' && preferences.showCharacterMask && (
          <p className="dictation-character-mask" aria-label={`答案由 ${Array.from(item.word).filter((character) => /[a-z]/i.test(character)).length} 个英文字母组成`}>
            {characterMask(item.word)}
          </p>
        )}
      </div>

      <DictationSpellingField
        inputRef={inputRef}
        value={answer}
        onChange={onAnswerChange}
        error={error}
        readOnly={phase === 'feedback'}
        expected={item.word}
        underlineMistakes={preferences.underlineMistakes}
      />

      {phase === 'prompt' ? (
        <div className="dictation-actions">
          <Button type="submit">提交</Button>
        </div>
      ) : (
        <div className={`dictation-feedback ${grade === 'correct' ? 'edge-success' : 'edge-danger'}`}>
          {grade === 'correct' ? (
            <p className="dictation-verdict dictation-verdict-correct">{currentStreak >= requiredStreak ? '拼写正确，该词已过关' : `拼写正确，连续 ${currentStreak} / ${requiredStreak}`}</p>
          ) : (
            <>
              <p className="dictation-verdict">拼写不对</p>
              <p className="dictation-streak-reset">连续正确次数已归零</p>
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
          {(preferences.showPhonetic || preferences.showMeaning) && <div className="dictation-answer-details">
            {preferences.showPhonetic && item.phonetic && <p className="dictation-answer-phonetic">{item.phonetic}</p>}
            {preferences.showMeaning && <MeaningList
              meanings={selectPreferredMeanings(item, preferences.meaningPreference)}
              showExamples={preferences.showExamples}
            />}
          </div>}
          <div className="dictation-actions">
            <Button type="submit">{isLast ? '看结果' : '下一题'}</Button>
          </div>
        </div>
      )}
    </form>
  )
}
