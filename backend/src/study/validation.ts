import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import {
  WORD_SOURCES, type CatalogExam, type CatalogQuery, type CatalogSort, type CreateMyWordbookInput,
  type LearningEventInput, type LearningGoal, type StudyMeaning, type StudyWordEntry,
  type UploadCatalogWordbookInput, type WordLearningStatus, type WordSource,
} from "./types.js";

type JsonObject = Record<string, unknown>;
const EXAMS = ["IELTS", "TOEFL", "GRE", "高考", "四六级", "考研"] as const;
const GOALS = ["写作", "阅读", "听力", "口语"] as const;
const SORTS = ["recommended", "hot", "newest", "rating"] as const;

export function isJsonObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function parseClientId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id) ? id : null;
}
export function parseResourceId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{1,80}$/.test(id) ? id : null;
}
export function parseShareCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{6,12}$/.test(code) ? code : null;
}
function text(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return (allowEmpty || result) && result.length <= max ? result : null;
}
function word(value: unknown): string | null {
  const result = typeof value === "string" ? normalizeWord(value) : "";
  return isValidWordQuery(result) ? result : null;
}
function audioUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
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
export function parseStudyWordEntry(value: unknown): StudyWordEntry | null {
  if (!isJsonObject(value)) return null;
  const parsedWord = word(value.word);
  const phonetic = value.phonetic === "" ? "" : text(value.phonetic, 120);
  const parsedAudio = audioUrl(value.audioUrl);
  const source = WORD_SOURCES.includes(value.source as WordSource) ? value.source as WordSource : null;
  if (!parsedWord || phonetic === null || parsedAudio === null || !source || !Array.isArray(value.meanings) || value.meanings.length > 200) return null;
  const meanings = value.meanings.map(meaning);
  if (meanings.some((item) => item === null)) return null;
  return { word: parsedWord, phonetic, ...(parsedAudio ? { audioUrl: parsedAudio } : {}), meanings: meanings as StudyMeaning[], source };
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
  return { title, ...(description ? { description } : {}), words: words as StudyWordEntry[] };
}
export function parseCreateMyWordbook(value: unknown): CreateMyWordbookInput | null { return parseWordbookInput(value); }
export function parseUploadCatalog(value: unknown): UploadCatalogWordbookInput | null {
  const base = parseWordbookInput(value); if (!base || !isJsonObject(value)) return null;
  const exams = choices(value.exams, EXAMS); const goals = choices(value.goals, GOALS);
  return exams && goals ? { ...base, exams, goals } : null;
}
export function parseLearningEvent(value: unknown): LearningEventInput | null {
  if (!isJsonObject(value)) return null;
  const wordbookId = parseResourceId(value.wordbookId); const parsedWord = word(value.word);
  if (!wordbookId || !parsedWord || typeof value.kind !== "string") return null;
  if (value.kind === "new") return { kind: "new", wordbookId, word: parsedWord };
  if (value.kind === "flashcard" && (value.verdict === "know" || value.verdict === "unknown")) return { kind: "flashcard", wordbookId, word: parsedWord, verdict: value.verdict };
  if (value.kind === "dictation" && typeof value.correct === "boolean") return { kind: "dictation", wordbookId, word: parsedWord, correct: value.correct };
  return null;
}
export function parseStatus(value: unknown): WordLearningStatus | null | undefined {
  if (value === undefined) return undefined;
  return value === "new" || value === "learning" || value === "review" || value === "mastered" ? value : null;
}
export function parseCatalogQuery(query: Record<string, unknown>): CatalogQuery | null {
  const q = query.q === undefined ? undefined : text(query.q, 100);
  const exam = query.exam === undefined ? undefined : EXAMS.includes(query.exam as CatalogExam) ? query.exam as CatalogExam : null;
  const goal = query.goal === undefined ? undefined : GOALS.includes(query.goal as LearningGoal) ? query.goal as LearningGoal : null;
  const sort = query.sort === undefined ? undefined : SORTS.includes(query.sort as CatalogSort) ? query.sort as CatalogSort : null;
  return q !== null && exam !== null && goal !== null && sort !== null ? { q, exam, goal, sort } : null;
}
