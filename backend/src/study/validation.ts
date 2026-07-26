import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import {
  WORD_SOURCES, type CatalogExam, type CatalogQuery, type CatalogSort, type CommitImportDraftInput, type CreateImportDraftInput,
  type CreateMyWordbookInput, type ImportLineInput, type ImportResolution, type LearningEventInput, type LearningGoal,
  type StudyMeaning, type StudyWordEntry, type UpdateCatalogWordbookInput, type UpdateWordInput, type UploadCatalogWordbookInput,
  type WordLearningStatus, type WordLevel, type WordSource, type ZhMeaningSource,
} from "./types.js";

type JsonObject = Record<string, unknown>;
const EXAMS = ["IELTS", "TOEFL", "GRE", "高考", "四六级", "考研"] as const;
const GOALS = ["写作", "阅读", "听力", "口语"] as const;
const SORTS = ["recommended", "hot", "newest", "rating"] as const;
const RESOLUTIONS = ["keep", "replace", "merge", "discard"] as const;

export function isJsonObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function parseClientId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id) ? id : null;
}
export function parseResourceId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{1,80}$/.test(id) ? id : null;
}
export function parseWordId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
export function parseShareCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{6,12}$/.test(code) ? code : null;
}
function text(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim(); return (allowEmpty || result) && result.length <= max ? result : null;
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
  const pos = text(value.pos, 80)?.toLowerCase(); const definition = text(value.definition, 1500);
  if (!pos || !definition) return null;
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
  if (!title || description === null) return null;
  if (value.words !== undefined && (!Array.isArray(value.words) || value.words.length > 500)) return null;
  const words = (value.words ?? []).map(parseStudyWordEntry);
  if (words.some((item) => item === null) || new Set(words.map((item) => item?.word)).size !== words.length) return null;
  return { title, ...(description !== undefined ? { description } : {}), words: words as StudyWordEntry[] };
}
export function parseCreateMyWordbook(value: unknown): CreateMyWordbookInput | null { return parseWordbookInput(value); }
export function parseUploadCatalog(value: unknown): UploadCatalogWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const sourceWordbookId = value.sourceWordbookId === undefined ? undefined : parseResourceId(value.sourceWordbookId);
  if (sourceWordbookId === null) return null;
  const exams = choices(value.exams, EXAMS); const goals = choices(value.goals, GOALS); if (!exams || !goals) return null;
  if (sourceWordbookId) {
    const title = value.title === undefined ? undefined : text(value.title, 100);
    const description = value.description === undefined ? undefined : text(value.description, 500, true);
    return title !== null && description !== null ? { sourceWordbookId, ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}), exams, goals } : null;
  }
  const base = parseWordbookInput(value); return base ? { ...base, exams, goals } : null;
}
export function parseUpdateCatalog(value: unknown): UpdateCatalogWordbookInput | null {
  if (!isJsonObject(value)) return null;
  const sourceWordbookId = value.sourceWordbookId === undefined ? undefined : parseResourceId(value.sourceWordbookId);
  const title = value.title === undefined ? undefined : text(value.title, 100); const description = value.description === undefined ? undefined : text(value.description, 500, true);
  const exams = value.exams === undefined ? undefined : choices(value.exams, EXAMS); const goals = value.goals === undefined ? undefined : choices(value.goals, GOALS);
  if (sourceWordbookId === null || title === null || description === null || exams === null || goals === null || (sourceWordbookId === undefined && title === undefined && description === undefined && exams === undefined && goals === undefined)) return null;
  return { ...(sourceWordbookId ? { sourceWordbookId } : {}), ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(exams ? { exams } : {}), ...(goals ? { goals } : {}) };
}
export function parseLearningEvent(value: unknown): LearningEventInput | null {
  if (!isJsonObject(value)) return null;
  const wordbookId = parseResourceId(value.wordbookId); const parsedWord = value.word === undefined ? undefined : word(value.word); const wordId = value.wordId === undefined ? undefined : parseWordId(value.wordId);
  if (!wordbookId || parsedWord === null || wordId === null || (!parsedWord && !wordId) || typeof value.kind !== "string") return null;
  const target = { wordbookId, ...(parsedWord ? { word: parsedWord } : {}), ...(wordId ? { wordId } : {}) };
  if (value.kind === "new") {
    if (value.verdict !== undefined && value.verdict !== "know" && value.verdict !== "unknown") return null;
    return { kind: "new", ...target, ...(value.verdict ? { verdict: value.verdict } : {}) };
  }
  if (value.kind === "flashcard" && (value.verdict === "know" || value.verdict === "unknown")) return { kind: "flashcard", ...target, verdict: value.verdict };
  if (value.kind === "dictation" && typeof value.correct === "boolean") return { kind: "dictation", ...target, correct: value.correct };
  // "mark" is a manual proficiency override; the payload level must be an integer 0-4.
  if (value.kind === "mark" && typeof value.level === "number" && Number.isInteger(value.level) && value.level >= 0 && value.level <= 4) return { kind: "mark", ...target, level: value.level as WordLevel };
  return null;
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

function parseRawContent(content: string): ImportLineInput[] {
  return content.split(/\r?\n/).map((raw, index) => {
    const cleaned = raw.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "");
    const [head = "", ...rest] = cleaned.split(/\s+/); return { line: index + 1, word: head, ...(rest.length ? { zhMeaning: rest.join(" ") } : {}) };
  }).filter((item) => item.word || item.zhMeaning);
}
export function parseCreateImportDraft(value: unknown): CreateImportDraftInput | null {
  if (!isJsonObject(value)) return null;
  const title = text(value.title, 100); const description = value.description === undefined ? undefined : text(value.description, 500, true); const targetWordbookId = value.targetWordbookId === undefined ? undefined : parseResourceId(value.targetWordbookId);
  if (!title || description === null || targetWordbookId === null) return null;
  let lines: ImportLineInput[];
  if (typeof value.content === "string") {
    if (value.content.length > 1_000_000) return null; lines = parseRawContent(value.content);
    if (lines.length > 10_000) return null;
  } else if (Array.isArray(value.lines) && value.lines.length <= 10_000) {
    let total = 0;
    const parsed = value.lines.map((item): ImportLineInput | null => {
      if (!isJsonObject(item) || !Number.isInteger(item.line) || typeof item.line !== "number" || item.line < 1 || item.line > 1_000_000) return null;
      const rawWord = text(item.word, 160, true); const zhMeaning = item.zhMeaning === undefined ? undefined : text(item.zhMeaning, 1000, true);
      if (rawWord === null || zhMeaning === null) return null; total += rawWord.length + (zhMeaning?.length ?? 0); return { line: item.line, word: rawWord, ...(zhMeaning ? { zhMeaning } : {}) };
    });
    if (parsed.some((item) => item === null) || total > 1_000_000) return null; lines = parsed as ImportLineInput[];
  } else return null;
  if (!lines.length) return null;
  return { title, ...(description !== undefined ? { description } : {}), ...(targetWordbookId ? { targetWordbookId } : {}), lines };
}
export function parseCommitImportDraft(value: unknown): CommitImportDraftInput | null {
  if (value === undefined || value === null) return {};
  if (!isJsonObject(value) || (value.resolutions !== undefined && !isJsonObject(value.resolutions))) return null;
  if (value.resolutions === undefined) return {};
  const pairs = Object.entries(value.resolutions); if (pairs.length > 10_000) return null;
  const resolutions: Record<string, ImportResolution> = {};
  for (const [key, resolution] of pairs) { if (!parseWordId(key) || !RESOLUTIONS.includes(resolution as ImportResolution)) return null; resolutions[key] = resolution as ImportResolution; }
  return { resolutions };
}
export function parseUpdateWord(value: unknown): UpdateWordInput | null {
  if (!isJsonObject(value)) return null;
  const parsedWord = value.word === undefined ? undefined : word(value.word); const zhMeaning = value.zhMeaning === undefined ? undefined : value.zhMeaning === null ? null : text(value.zhMeaning, 1000, true); const phonetic = value.phonetic === undefined ? undefined : text(value.phonetic, 120, true); const parsedAudio = audioUrl(value.audioUrl); const parsedMeanings = value.meanings === undefined ? undefined : meanings(value.meanings);
  if (parsedWord === null || zhMeaning === null && value.zhMeaning !== null || phonetic === null || parsedAudio === undefined && value.audioUrl !== undefined || parsedMeanings === null || (parsedWord === undefined && zhMeaning === undefined && phonetic === undefined && value.audioUrl === undefined && parsedMeanings === undefined)) return null;
  return { ...(parsedWord ? { word: parsedWord } : {}), ...(zhMeaning !== undefined ? { zhMeaning } : {}), ...(phonetic !== undefined ? { phonetic } : {}), ...(value.audioUrl !== undefined ? { audioUrl: parsedAudio } : {}), ...(parsedMeanings !== undefined ? { meanings: parsedMeanings } : {}) };
}
