import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import {
  WORD_SOURCES, type CatalogExam, type CatalogQuery, type CatalogSort, type CatalogWordsQuery, type CommitImportDraftInput, type CreateCatalogContributionInput, type CreateImportDraftInput,
  type CursorQuery,
  type CreateMyWordbookInput, type ImportLineInput, type ImportResolution, type LearningEventInput, type LearningGoal,
  type BatchWordAction, type DictationDisplayPreferences, type FlashcardDisplayPreferences, type PronunciationPreferences, type ReviewSchedule, type StartStudyRoundInput, type StudyDisplayPreferences, type StudyExerciseType, type StudyMeaning, type StudyRoundAnswerInput, type StudyShortcutPreferences, type StudyWordEntry,
  type ResolveCatalogContributionInput, type RevertRevisionInput, type UpdateCatalogWordbookInput, type UpdateMyWordbookInput, type UpdateStudySettingsInput, type UpdateWordInput, type UploadCatalogWordbookInput, type WordbookStudyPreferences,
  type WordLearningStatus, type WordLevel, type WordSource, type ZhMeaningSource,
} from "./types.js";

type JsonObject = Record<string, unknown>;
const EXAMS = ["IELTS", "TOEFL", "GRE", "高考", "四级", "六级", "四六级", "考研"] as const;
const GOALS = ["写作", "阅读", "听力", "口语"] as const;
const SORTS = ["recommended", "hot", "newest", "rating"] as const;
const RESOLUTIONS = ["keep", "replace", "merge", "discard"] as const;
const VISIBILITIES = ["public", "unlisted", "private"] as const;
export const CATALOG_TITLE_MAX_LENGTH = 40;
export const MAX_IMPORT_LINES = 10_000;

export function isJsonObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function parseClientId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id)) return null;
  return ["__proto__", "prototype", "constructor"].includes(id.toLowerCase()) ? null : id;
}
export function parseResourceId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{1,80}$/.test(id) ? id : null;
}
export function parseWordId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
export function parseBatchWords(value: unknown): { action: BatchWordAction; wordIds: string[] } | null {
  if (!isJsonObject(value)) return null;
  const action = value.action;
  if (action !== "refresh-meanings" && action !== "delete" && action !== "mark-mastered") return null;
  if (!Array.isArray(value.wordIds) || value.wordIds.length === 0 || value.wordIds.length > 500) return null;
  const wordIds = value.wordIds.map(parseWordId);
  if (wordIds.some((id) => id === null)) return null;
  const unique = [...new Set(wordIds as string[])];
  return unique.length === wordIds.length ? { action, wordIds: unique } : null;
}
export function parseShareCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  // Accept legacy short codes while new uploads use 24 hexadecimal characters
  // (96 bits), making online guessing impractical even under sustained traffic.
  return /^[A-Z0-9]{6,24}$/.test(code) ? code : null;
}
function text(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim(); return (allowEmpty || result) && result.length <= max ? result : null;
}
export function isCatalogTitle(value: unknown): value is string { return text(value, CATALOG_TITLE_MAX_LENGTH) !== null; }
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}
function word(value: unknown): string | null {
  const result = typeof value === "string" ? normalizeWord(value) : "";
  return isValidWordQuery(result) ? result : null;
}
function audioUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value.trim()); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}
function meaning(value: unknown): StudyMeaning | null {
  if (!isJsonObject(value)) return null;
  const pos = text(value.pos, 80)?.toLowerCase(); const definition = text(value.definition, 1500, true);
  if (!pos || definition === null) return null;
  if (value.example === undefined) return { pos, definition };
  const example = text(value.example, 1500); return example ? { pos, definition, example } : null;
}
function meanings(value: unknown): StudyMeaning[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const parsed = value.map(meaning); return parsed.some((item) => item === null) ? null : parsed as StudyMeaning[];
}
export function parseStudyWordEntry(value: unknown): StudyWordEntry | null {
  if (!isJsonObject(value)) return null;
  const parsedWord = word(value.word); const phonetic = value.phonetic === "" ? "" : text(value.phonetic, 120); const parsedAudio = audioUrl(value.audioUrl);
  const source = WORD_SOURCES.includes(value.source as WordSource) ? value.source as WordSource : null; const parsedMeanings = meanings(value.meanings);
  const zhMeaning = value.zhMeaning === undefined ? undefined : text(value.zhMeaning, 1000);
  const zhMeaningSource = value.zhMeaningSource === undefined ? undefined : value.zhMeaningSource === "user" || value.zhMeaningSource === "dictionary" ? value.zhMeaningSource as ZhMeaningSource : null;
  if (!parsedWord || phonetic === null || parsedAudio === null || !source || !parsedMeanings || zhMeaning === null || zhMeaningSource === null || (!zhMeaning && zhMeaningSource)) return null;
  return { word: parsedWord, phonetic, ...(parsedAudio ? { audioUrl: parsedAudio } : {}), meanings: parsedMeanings, source, ...(zhMeaning ? { zhMeaning } : {}), ...(zhMeaningSource ? { zhMeaningSource } : {}) };
}
function choices<T extends string>(value: unknown, all: readonly T[]): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > all.length) return null;
  const result = value.filter((item): item is T => typeof item === "string" && (all as readonly string[]).includes(item));
  return result.length === value.length && new Set(result).size === result.length ? result : null;
}
function parseWordbookInput(value: unknown): CreateMyWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const title = text(value.title, 100); const description = value.description === undefined ? undefined : text(value.description, 500, true);
  const category = value.category === undefined ? undefined : text(value.category, 30);
  if (!title || description === null || category === null) return null;
  if (value.words !== undefined && (!Array.isArray(value.words) || value.words.length > 500)) return null;
  const words = (value.words ?? []).map(parseStudyWordEntry);
  if (words.some((item) => item === null) || new Set(words.map((item) => item?.word)).size !== words.length) return null;
  return { title, ...(description !== undefined ? { description } : {}), ...(category ? { category } : {}), words: words as StudyWordEntry[] };
}
export function parseCreateMyWordbook(value: unknown): CreateMyWordbookInput | null { return parseWordbookInput(value); }
function parseReviewSchedule(value: unknown): ReviewSchedule | null {
  if (!isJsonObject(value)) return null;
  const day = (item: unknown) => typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 3650 ? item : null;
  const learningDays = day(value.learningDays);
  const familiarDays = day(value.familiarDays);
  const masteredDays = day(value.masteredDays);
  const expertDays = day(value.expertDays);
  const lapseDays = day(value.lapseDays);
  const maxDays = day(value.maxDays);
  if (learningDays === null || familiarDays === null || masteredDays === null || expertDays === null || lapseDays === null || maxDays === null) return null;
  if (learningDays > familiarDays || familiarDays > masteredDays || masteredDays > expertDays || expertDays > maxDays || lapseDays > maxDays) return null;
  return { learningDays, familiarDays, masteredDays, expertDays, lapseDays, maxDays };
}
function parseDisplayPreferences(value: unknown): StudyDisplayPreferences | null {
  if (!isJsonObject(value)) return null;
  if (
    (value.meaningPreference !== "zh" && value.meaningPreference !== "en")
    || typeof value.showExamples !== "boolean"
    || typeof value.showPhonetic !== "boolean"
    || typeof value.autoPlayAudio !== "boolean"
  ) return null;
  return {
    meaningPreference: value.meaningPreference,
    showExamples: value.showExamples,
    showPhonetic: value.showPhonetic,
    autoPlayAudio: value.autoPlayAudio,
  };
}
const DEFAULT_EXERCISES: StudyExerciseType[] = ["self-rating", "meaning-choice"];
function parseFlashcardPreferences(value: unknown): FlashcardDisplayPreferences | null {
  const display = parseDisplayPreferences(value);
  if (!display || !isJsonObject(value)) return null;
  const source = value.exerciseTypes === undefined ? DEFAULT_EXERCISES : value.exerciseTypes;
  if (!Array.isArray(source) || source.length < 1 || source.length > DEFAULT_EXERCISES.length) return null;
  const exerciseTypes = source.filter((item): item is StudyExerciseType => DEFAULT_EXERCISES.includes(item as StudyExerciseType));
  if (exerciseTypes.length !== source.length || new Set(exerciseTypes).size !== exerciseTypes.length) return null;
  return { ...display, exerciseTypes };
}
export function parseWordbookStudyPreferences(value: unknown): WordbookStudyPreferences | null {
  if (!isJsonObject(value) || !isJsonObject(value.plan) || !isJsonObject(value.modes)) return null;
  const count = (item: unknown) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 999 ? item : null;
  const newWords = count(value.plan.newWords);
  const dictationCount = count(value.plan.dictation);
  const backlogReviews = value.plan.backlogReviews === undefined ? 50 : count(value.plan.backlogReviews);
  const newMode = parseFlashcardPreferences(value.modes.new);
  const review = parseFlashcardPreferences(value.modes.review);
  const dictationBase = parseDisplayPreferences(value.modes.dictation);
  const dictationSource = value.modes.dictation;
  if (
    newWords === null
    || dictationCount === null
    || backlogReviews === null
    || !newMode
    || !review
    || !dictationBase
    || !isJsonObject(dictationSource)
    || typeof dictationSource.underlineMistakes !== "boolean"
    || typeof dictationSource.showMeaning !== "boolean"
    || typeof dictationSource.showCharacterMask !== "boolean"
  ) return null;
  const dictation: DictationDisplayPreferences = {
    ...dictationBase,
    underlineMistakes: dictationSource.underlineMistakes,
    showMeaning: dictationSource.showMeaning,
    showCharacterMask: dictationSource.showCharacterMask,
  };
  return {
    plan: { newWords, dictation: dictationCount, backlogReviews },
    modes: { new: newMode, review, dictation },
  };
}
function parseStudyShortcuts(value: unknown): StudyShortcutPreferences | null {
  if (!isJsonObject(value)) return null;
  const actions = ["unknown", "pronounce", "known", "flip", "dictationPronounce"] as const;
  const special = new Set(["enter", " ", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
  const parsed = {} as Omit<StudyShortcutPreferences, "vague"> & { vague?: string };
  for (const action of actions) {
    if (typeof value[action] !== "string") return null;
    const key = value[action].toLocaleLowerCase();
    if (!special.has(key) && !/^[a-z0-9]$/.test(key)) return null;
    parsed[action] = key;
  }
  if (value.vague !== undefined) {
    if (typeof value.vague !== "string") return null;
    const key = value.vague.toLocaleLowerCase();
    if (!special.has(key) && !/^[a-z0-9]$/.test(key)) return null;
    parsed.vague = key;
  } else {
    parsed.vague = ["w", "v", "r", "f"].find((key) => ![parsed.unknown, parsed.pronounce, parsed.known, parsed.flip].includes(key)) ?? "w";
  }
  const flashcard = [parsed.unknown, parsed.vague, parsed.pronounce, parsed.known, parsed.flip];
  if (new Set(flashcard).size !== flashcard.length || parsed.dictationPronounce === "enter") return null;
  return parsed as StudyShortcutPreferences;
}
export function parseUpdateStudySettings(value: unknown): UpdateStudySettingsInput | null {
  if (!isJsonObject(value)) return null;
  const hasShortcuts = Object.hasOwn(value, "shortcuts");
  const hasPronunciation = Object.hasOwn(value, "pronunciation");
  if (!hasShortcuts && !hasPronunciation) return null;
  const shortcuts = hasShortcuts ? parseStudyShortcuts(value.shortcuts) : undefined;
  let pronunciation: PronunciationPreferences | undefined;
  if (
    hasPronunciation
    && isJsonObject(value.pronunciation)
    && (value.pronunciation.accent === "gb" || value.pronunciation.accent === "us")
  ) pronunciation = { accent: value.pronunciation.accent };
  if ((hasShortcuts && !shortcuts) || (hasPronunciation && !pronunciation)) return null;
  return {
    ...(shortcuts ? { shortcuts } : {}),
    ...(pronunciation ? { pronunciation } : {}),
  };
}
export function parseUpdateMyWordbook(value: unknown): UpdateMyWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const hasCategory = Object.hasOwn(value, "category");
  const hasReviewSchedule = Object.hasOwn(value, "reviewSchedule");
  const hasStudyPreferences = Object.hasOwn(value, "studyPreferences");
  if (!hasCategory && !hasReviewSchedule && !hasStudyPreferences) return null;
  const input: UpdateMyWordbookInput = {};
  if (hasCategory) {
    if (value.category === null) input.category = null;
    else {
      const category = text(value.category, 30);
      if (!category) return null;
      input.category = category;
    }
  }
  if (hasReviewSchedule) {
    const reviewSchedule = parseReviewSchedule(value.reviewSchedule);
    if (!reviewSchedule) return null;
    input.reviewSchedule = reviewSchedule;
  }
  if (hasStudyPreferences) {
    const studyPreferences = parseWordbookStudyPreferences(value.studyPreferences);
    if (!studyPreferences) return null;
    input.studyPreferences = studyPreferences;
  }
  return input;
}
export function parseUploadCatalog(value: unknown): UploadCatalogWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const sourceWordbookId = value.sourceWordbookId === undefined ? undefined : parseResourceId(value.sourceWordbookId);
  if (sourceWordbookId === null) return null;
  const exams = choices(value.exams, EXAMS); const goals = choices(value.goals, GOALS); if (!exams || !goals) return null;
  const visibility = value.visibility === undefined ? undefined : VISIBILITIES.includes(value.visibility as typeof VISIBILITIES[number]) ? value.visibility as typeof VISIBILITIES[number] : null;
  const message = value.message === undefined ? undefined : text(value.message, 80);
  if (visibility === null || message === null) return null;
  if (sourceWordbookId) {
    const title = value.title === undefined ? undefined : text(value.title, CATALOG_TITLE_MAX_LENGTH);
    const description = value.description === undefined ? undefined : text(value.description, 500, true);
    return title !== null && description !== null ? { sourceWordbookId, ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}), exams, goals, ...(visibility ? { visibility } : {}), ...(message ? { message } : {}) } : null;
  }
  const base = parseWordbookInput(value); return base && isCatalogTitle(base.title) ? { ...base, exams, goals, ...(visibility ? { visibility } : {}), ...(message ? { message } : {}) } : null;
}
export function parseUpdateCatalog(value: unknown): UpdateCatalogWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const sourceWordbookId = value.sourceWordbookId === undefined ? undefined : parseResourceId(value.sourceWordbookId);
  const expectedHeadRevisionId = value.expectedHeadRevisionId === undefined ? undefined : parseResourceId(value.expectedHeadRevisionId);
  const title = value.title === undefined ? undefined : text(value.title, CATALOG_TITLE_MAX_LENGTH); const description = value.description === undefined ? undefined : text(value.description, 500, true);
  const exams = value.exams === undefined ? undefined : choices(value.exams, EXAMS); const goals = value.goals === undefined ? undefined : choices(value.goals, GOALS);
  const visibility = value.visibility === undefined ? undefined : VISIBILITIES.includes(value.visibility as typeof VISIBILITIES[number]) ? value.visibility as typeof VISIBILITIES[number] : null;
  const message = value.message === undefined ? undefined : text(value.message, 80);
  if (sourceWordbookId === null || expectedHeadRevisionId === null || title === null || description === null || exams === null || goals === null || visibility === null || message === null || (sourceWordbookId === undefined && title === undefined && description === undefined && exams === undefined && goals === undefined && visibility === undefined)) return null;
  return { ...(sourceWordbookId ? { sourceWordbookId } : {}), ...(expectedHeadRevisionId ? { expectedHeadRevisionId } : {}), ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(exams ? { exams } : {}), ...(goals ? { goals } : {}), ...(visibility ? { visibility } : {}), ...(message ? { message } : {}) };
}

export function parseCursorQuery(value: unknown): CursorQuery | null {
  if (!isJsonObject(value)) return null;
  const cursor = value.cursor === undefined
    ? undefined
    : typeof value.cursor === "string" && /^[A-Za-z0-9_-]{1,500}$/.test(value.cursor)
      ? value.cursor
      : null;
  const rawLimit = value.limit === undefined ? 20 : typeof value.limit === "string" ? Number(value.limit) : value.limit;
  const limit = typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 50
    ? rawLimit
    : null;
  if (cursor === null || limit === null) return null;
  return { ...(cursor ? { cursor } : {}), limit };
}

export function parseCreateCatalogContribution(value: unknown): CreateCatalogContributionInput | null {
  if (!isJsonObject(value)) return null;
  const title = text(value.title, 80);
  const description = value.description === undefined ? undefined : text(value.description, 1000, true);
  const expectedSourceUpdatedAt = timestamp(value.expectedSourceUpdatedAt);
  const expectedHeadRevisionId = parseResourceId(value.expectedHeadRevisionId);
  if (!title || title.length < 2 || description === null || !expectedSourceUpdatedAt || !expectedHeadRevisionId) return null;
  return {
    title,
    ...(description !== undefined ? { description } : {}),
    expectedSourceUpdatedAt,
    expectedHeadRevisionId,
  };
}

export function parseResolveCatalogContribution(value: unknown): ResolveCatalogContributionInput | null {
  if (!isJsonObject(value)) return null;
  const expectedHeadRevisionId = value.expectedHeadRevisionId === undefined
    ? undefined
    : parseResourceId(value.expectedHeadRevisionId);
  const resolutionNote = value.resolutionNote === undefined ? undefined : text(value.resolutionNote, 500, true);
  if (expectedHeadRevisionId === null || resolutionNote === null) return null;
  return {
    ...(expectedHeadRevisionId ? { expectedHeadRevisionId } : {}),
    ...(resolutionNote !== undefined ? { resolutionNote } : {}),
  };
}

export function parseRevertRevision(value: unknown): RevertRevisionInput | null {
  if (!isJsonObject(value)) return null;
  const expectedHeadRevisionId = parseResourceId(value.expectedHeadRevisionId);
  const message = value.message === undefined ? undefined : text(value.message, 80);
  if (!expectedHeadRevisionId || message === null) return null;
  return { expectedHeadRevisionId, ...(message ? { message } : {}) };
}
export function parseLearningEvent(value: unknown): LearningEventInput | null {
  if (!isJsonObject(value)) return null;
  const wordbookId = parseResourceId(value.wordbookId); const parsedWord = value.word === undefined ? undefined : word(value.word); const wordId = value.wordId === undefined ? undefined : parseWordId(value.wordId);
  if (!wordbookId || parsedWord === null || wordId === null || (!parsedWord && !wordId) || typeof value.kind !== "string") return null;
  const target = { wordbookId, ...(parsedWord ? { word: parsedWord } : {}), ...(wordId ? { wordId } : {}) };
  if (value.kind === "new") {
    if (value.verdict !== undefined && value.verdict !== "know" && value.verdict !== "vague" && value.verdict !== "unknown") return null;
    return { kind: "new", ...target, ...(value.verdict ? { verdict: value.verdict } : {}) };
  }
  if (value.kind === "flashcard" && (value.verdict === "know" || value.verdict === "vague" || value.verdict === "unknown")) return { kind: "flashcard", ...target, verdict: value.verdict };
  if (value.kind === "dictation" && typeof value.correct === "boolean") return { kind: "dictation", ...target, correct: value.correct };
  // "mark" is a manual proficiency override; the payload level must be an integer 0-4.
  if (value.kind === "mark" && typeof value.level === "number" && Number.isInteger(value.level) && value.level >= 0 && value.level <= 4) return { kind: "mark", ...target, level: value.level as WordLevel };
  return null;
}
export function parseStartStudyRound(value: unknown): StartStudyRoundInput | null {
  if (!isJsonObject(value)) return null;
  const wordbookId = parseResourceId(value.wordbookId);
  const mode = value.mode === "new" || value.mode === "review" ? value.mode : null;
  const scope = value.scope === undefined
    ? "standard"
    : value.scope === "standard" || value.scope === "backlog" || value.scope === "ahead"
      ? value.scope
      : null;
  if (!wordbookId || !mode || !scope || (mode === "new" && scope !== "standard")) return null;
  return { wordbookId, mode, scope };
}
export function parseStudyRoundAnswer(value: unknown): StudyRoundAnswerInput | null {
  if (!isJsonObject(value)) return null;
  const taskId = parseWordId(value.taskId);
  const operationId = parseWordId(value.operationId);
  const response = value.response === "know" || value.response === "vague" || value.response === "unknown"
    || value.response === "correct" || value.response === "incorrect"
    ? value.response
    : null;
  const revision = typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
    ? value.revision
    : null;
  return taskId && operationId && response && revision !== null ? { taskId, operationId, response, revision } : null;
}
export function parseStudyRoundRevision(value: unknown): number | null {
  if (!isJsonObject(value)) return null;
  return typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 0
    ? value.revision
    : null;
}
export function parseAddWord(value: unknown): { word: string; zhMeaning?: string } | null {
  if (!isJsonObject(value)) return null;
  const parsedWord = word(value.word);
  // zhMeaning is optional and shares the import-line length cap (1000).
  const zhMeaning = value.zhMeaning === undefined ? undefined : text(value.zhMeaning, 1000, true);
  if (!parsedWord || zhMeaning === null) return null;
  return { word: parsedWord, ...(zhMeaning ? { zhMeaning } : {}) };
}
export function parseStatus(value: unknown): WordLearningStatus | null | undefined { if (value === undefined) return undefined; return value === "new" || value === "learning" || value === "review" || value === "mastered" ? value : null; }
export function parseCatalogQuery(query: Record<string, unknown>): CatalogQuery | null {
  const q = query.q === undefined ? undefined : text(query.q, 100); const exam = query.exam === undefined ? undefined : EXAMS.includes(query.exam as CatalogExam) ? query.exam as CatalogExam : null; const goal = query.goal === undefined ? undefined : GOALS.includes(query.goal as LearningGoal) ? query.goal as LearningGoal : null; const sort = query.sort === undefined ? undefined : SORTS.includes(query.sort as CatalogSort) ? query.sort as CatalogSort : null;
  return q !== null && exam !== null && goal !== null && sort !== null ? { q, exam, goal, sort } : null;
}

export function parseCatalogWordsQuery(query: Record<string, unknown>): CatalogWordsQuery | null {
  const positiveInteger = (value: unknown, fallback: number, maximum: number): number | null => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
  };
  const page = positiveInteger(query.page, 1, 100_000);
  const pageSize = positiveInteger(query.pageSize, 50, 100);
  const q = query.q === undefined ? undefined : text(query.q, 100);
  return page !== null && pageSize !== null && q !== null ? { page, pageSize, ...(q ? { q } : {}) } : null;
}

export function parseCreateImportDraft(value: unknown): CreateImportDraftInput | null {
  if (!isJsonObject(value)) return null;
  const title = text(value.title, 100); const description = value.description === undefined ? undefined : text(value.description, 500, true); const targetWordbookId = value.targetWordbookId === undefined ? undefined : parseResourceId(value.targetWordbookId);
  if (!title || description === null || targetWordbookId === null) return null;
  let lines: ImportLineInput[];
  if (Array.isArray(value.lines) && value.lines.length <= MAX_IMPORT_LINES) {
    let total = 0;
    const parsed = value.lines.map((item): ImportLineInput | null => {
      if (!isJsonObject(item) || !Number.isInteger(item.line) || typeof item.line !== "number" || item.line < 1 || item.line > 1_000_000) return null;
      const rawWord = text(item.word, 160, true);
      const phonetic = item.phonetic === undefined ? undefined : text(item.phonetic, 120, true);
      const pos = item.pos === undefined ? undefined : text(item.pos, 80, true);
      const enDefinition = item.enDefinition === undefined ? undefined : text(item.enDefinition, 1500, true);
      const zhMeaning = item.zhMeaning === undefined ? undefined : text(item.zhMeaning, 1000, true);
      const example = item.example === undefined ? undefined : text(item.example, 1500, true);
      const sourceReason = item.sourceReason === undefined ? undefined : text(item.sourceReason, 240, true);
      const parsedMeanings = item.meanings === undefined ? undefined : meanings(item.meanings);
      if (rawWord === null || phonetic === null || pos === null || enDefinition === null || zhMeaning === null || example === null || sourceReason === null || parsedMeanings === null) return null;
      total += rawWord.length + (phonetic?.length ?? 0) + (pos?.length ?? 0) + (enDefinition?.length ?? 0) + (zhMeaning?.length ?? 0) + (example?.length ?? 0)
        + (sourceReason?.length ?? 0)
        + (parsedMeanings?.reduce((sum, meaning) => sum + meaning.pos.length + meaning.definition.length + (meaning.example?.length ?? 0), 0) ?? 0);
      return {
        line: item.line, word: rawWord,
        ...(phonetic ? { phonetic } : {}), ...(pos ? { pos } : {}), ...(enDefinition ? { enDefinition } : {}),
        ...(zhMeaning ? { zhMeaning } : {}), ...(example ? { example } : {}),
        ...(parsedMeanings !== undefined ? { meanings: parsedMeanings } : {}),
        ...(sourceReason ? { sourceReason } : {}),
      };
    });
    if (parsed.some((item) => item === null) || total > 1_000_000) return null; lines = parsed as ImportLineInput[];
  } else return null;
  if (!lines.length) return null;
  return { title, ...(description !== undefined ? { description } : {}), ...(targetWordbookId ? { targetWordbookId } : {}), lines };
}
export function parseCommitImportDraft(value: unknown): CommitImportDraftInput | null {
  if (value === undefined || value === null) return {};
  if (!isJsonObject(value) || (value.resolutions !== undefined && !isJsonObject(value.resolutions))) return null;
  const mode = value.mode === undefined ? undefined : value.mode === "append" || value.mode === "overwrite" ? value.mode : null;
  if (mode === null) return null;
  if (value.resolutions === undefined) return mode ? { mode } : {};
  const pairs = Object.entries(value.resolutions); if (pairs.length > MAX_IMPORT_LINES) return null;
  const resolutions: Record<string, ImportResolution> = {};
  for (const [key, resolution] of pairs) { if (!parseWordId(key) || !RESOLUTIONS.includes(resolution as ImportResolution)) return null; resolutions[key] = resolution as ImportResolution; }
  return { ...(mode ? { mode } : {}), resolutions };
}
export function parseUpdateWord(value: unknown): UpdateWordInput | null {
  if (!isJsonObject(value)) return null;
  const parsedWord = value.word === undefined ? undefined : word(value.word); const zhMeaning = value.zhMeaning === undefined ? undefined : value.zhMeaning === null ? null : text(value.zhMeaning, 1000, true); const phonetic = value.phonetic === undefined ? undefined : text(value.phonetic, 120, true); const parsedAudio = audioUrl(value.audioUrl); const parsedMeanings = value.meanings === undefined ? undefined : meanings(value.meanings);
  if (parsedWord === null || zhMeaning === null && value.zhMeaning !== null || phonetic === null || parsedAudio === undefined && value.audioUrl !== undefined || parsedMeanings === null || (parsedWord === undefined && zhMeaning === undefined && phonetic === undefined && value.audioUrl === undefined && parsedMeanings === undefined)) return null;
  return { ...(parsedWord ? { word: parsedWord } : {}), ...(zhMeaning !== undefined ? { zhMeaning } : {}), ...(phonetic !== undefined ? { phonetic } : {}), ...(value.audioUrl !== undefined ? { audioUrl: parsedAudio } : {}), ...(parsedMeanings !== undefined ? { meanings: parsedMeanings } : {}) };
}
