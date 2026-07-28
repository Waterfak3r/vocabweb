import { randomUUID } from "node:crypto";
import { isJsonObject } from "./validation.js";
import { FINAL_CHECK_WINDOW_MS } from "./types.js";
import type {
  AccountUser, CatalogCard, CatalogWordbook, ImportDraft, LearningEvent, LevelCounts, MyWordbook, MyWordbookCard,
  StudiedWord, StudyMeaning, StudyWordEntry, LearningQueueItem, WordLearningStatus, WordLevel, WordbookProgress, WordbookWord,
} from "./types.js";

/** Per-anonymous-client data home: favorites, private wordbooks, learning events, and import drafts. */
export interface ClientData { favorites: string[]; wordbooks: MyWordbook[]; events: LearningEvent[]; drafts: ImportDraft[]; }
/** A persisted session: the sha256 of the cookie token, its owner, and expiry. */
export interface SessionRecord { tokenHash: string; userId: string; expiresAt: string; createdAt: string; }
/** The whole persisted world. SQLite splits this across tables; JSON/memory keep it as one document. */
export interface State { version: 3 | 4 | 5; catalog: CatalogWordbook[]; clients: Record<string, ClientData>; users: AccountUser[]; sessions: SessionRecord[]; }
export const EMPTY = (): State => ({ version: 5, catalog: [], clients: {}, users: [], sessions: [] });
export const RETENTION_MS = 90 * 86_400_000;
export const BATCH_SIZE = 500;

export function clone<T>(value: T): T { return structuredClone(value); }
export function day(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function shiftDay(now: Date, offset: number): Date { const result = new Date(now); result.setDate(now.getDate() + offset); return result; }
/** Whole local calendar days from `from` to `to`, DST-safe: both are collapsed to local midnight and the gap is rounded, so a ±1h DST shift never miscounts. */
export function dayDiff(from: Date, to: Date): number { return Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000); }
export function toWordbookWords(words: StudyWordEntry[], at: string): WordbookWord[] { return words.map((word) => ({ ...clone(word), id: randomUUID(), addedAt: at })); }
export function toCatalogWords(words: WordbookWord[]): StudyWordEntry[] { return words.map(({ id: _id, addedAt: _addedAt, ...word }) => clone(word)); }
export function defaultClient(): ClientData { return { favorites: [], wordbooks: [], events: [], drafts: [] }; }

export interface WordLadderState {
  level: WordLevel;
  levelReachedAt?: string;
  lastStudiedAt?: string;
  recognitionStreak: 0 | 1 | 2;
}
/**
 * Replay one word's full event history into its proficiency ladder state. Events must arrive
 * oldest-first (ties keep insertion order). `levelReachedAt` is the occurredAt of the event that
 * last CHANGED the level; a "mark" always counts as a change, even to the same rung — so it also
 * doubles as "when L3 was reached" for the 7-day final-check window.
 */
export function replayLadder(events: LearningEvent[], onEvent?: (event: LearningEvent, level: WordLevel) => void): WordLadderState {
  let level: WordLevel = 0;
  let levelReachedAt: string | undefined;
  let recognitionStreak: 0 | 1 | 2 = 0;
  for (const event of events) {
    const previous: WordLevel = level;
    switch (event.kind) {
      case "new":
        // New words require three consecutive recognition passes. Legacy events
        // without a verdict count as "know", preserving forward progress.
        if (level === 0) {
          if (event.verdict === "unknown") recognitionStreak = 0;
          else if (recognitionStreak === 2) {
            level = 1;
            recognitionStreak = 0;
          } else recognitionStreak = (recognitionStreak + 1) as 1 | 2;
        }
        break;
      case "flashcard": // 认识 climbs one rung but flashcards can never pass L2; 不认识 demotes to a floor of L1.
        level = event.verdict === "know" ? (level < 2 ? (level + 1) as WordLevel : level) : Math.max(1, level - 1) as WordLevel; break;
      case "dictation":
        if (event.correct) {
          // L2 → L3 at once; L3 → L4 only once the 7-day window has passed; L0/L1 never promote.
          if (level === 2) level = 3;
          else if (level === 3 && levelReachedAt !== undefined && Date.parse(event.occurredAt) - Date.parse(levelReachedAt) >= FINAL_CHECK_WINDOW_MS) level = 4;
        } else level = Math.max(1, level - 1) as WordLevel;
        break;
      case "mark": // Manual override to an exact rung.
        level = event.level;
        recognitionStreak = 0;
        break;
    }
    if (level !== previous || event.kind === "mark") levelReachedAt = event.occurredAt;
    onEvent?.(event, level);
  }
  // Events arrive oldest-first, so the tail is the most recent touch of ANY kind (mark included) —
  // the spaced-review clock's "last studied" stamp.
  const lastStudiedAt = events.length ? events[events.length - 1]!.occurredAt : undefined;
  return { level, recognitionStreak, ...(levelReachedAt !== undefined ? { levelReachedAt } : {}), ...(lastStudiedAt !== undefined ? { lastStudiedAt } : {}) };
}
/**
 * Bucket a wordbook's events by wordId in one pass. Each bucket is stable-sorted by occurredAt so
 * an injected/rewound clock or migrated data still replays strictly chronologically (Array.sort is
 * stable, so equal timestamps keep their insertion order).
 */
function bucketByWord(events: LearningEvent[]): Map<string, LearningEvent[]> {
  const buckets = new Map<string, LearningEvent[]>();
  for (const event of events) {
    const bucket = buckets.get(event.wordId);
    if (bucket) bucket.push(event); else buckets.set(event.wordId, [event]);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  return buckets;
}
export function ladderStates(events: LearningEvent[]): Map<string, WordLadderState> {
  const states = new Map<string, WordLadderState>();
  for (const [wordId, bucket] of bucketByWord(events)) states.set(wordId, replayLadder(bucket));
  return states;
}
/** Level each word held right AFTER each event, keyed by event id — feeds recentActivity honesty. */
export function ladderEventLevels(events: LearningEvent[]): Map<string, WordLevel> {
  const after = new Map<string, WordLevel>();
  for (const bucket of bucketByWord(events).values()) replayLadder(bucket, (event, level) => after.set(event.id, level));
  return after;
}
export function ladderOf(states: Map<string, WordLadderState>, wordId: string): WordLadderState { return states.get(wordId) ?? { level: 0, recognitionStreak: 0 }; }
// Legacy 4-status compat kept for the ?status= filter: L0 new / L1 learning / L2 review / L3-L4 mastered.
function statusFromLevel(level: WordLevel): WordLearningStatus { return level === 0 ? "new" : level === 1 ? "learning" : level === 2 ? "review" : "mastered"; }
function studiedWordOf(word: WordbookWord, state: WordLadderState): StudiedWord { return { ...clone(word), level: state.level, recognitionStreak: state.recognitionStreak, ...(state.levelReachedAt !== undefined ? { levelReachedAt: state.levelReachedAt } : {}), ...(state.lastStudiedAt !== undefined ? { lastStudiedAt: state.lastStudiedAt } : {}) }; }
export { studiedWordOf as studiedWord };
export function queueItem(word: WordbookWord, state: WordLadderState): LearningQueueItem { return { ...studiedWordOf(word, state), status: statusFromLevel(state.level) }; }
/**
 * 复习巩固 due rule on server-local calendar days: an L1 word becomes due 1 day after its last event,
 * an L2 word 2 days after (so `dayDiff >= level` covers both). L0/L3/L4 are never review-due — L3 has
 * its own 7-day final-check window. A level-1|2 word with no recorded event is treated as due.
 */
export function reviewDue(state: WordLadderState, now: Date): boolean {
  if (state.level !== 1 && state.level !== 2) return false;
  if (state.lastStudiedAt === undefined) return true;
  return dayDiff(new Date(state.lastStudiedAt), now) >= state.level;
}
export function progress(book: MyWordbook, events: LearningEvent[]): WordbookProgress {
  const states = ladderStates(events);
  const levels: LevelCounts = { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 };
  for (const word of book.words) levels[`l${ladderOf(states, word.id).level}` as keyof LevelCounts] += 1;
  const total = book.words.length;
  const percent = total ? Math.round(((levels.l1 * 0.25 + levels.l2 * 0.5 + levels.l3 * 0.75 + levels.l4) / total) * 100) : 0;
  return { mastered: levels.l3 + levels.l4, learning: levels.l1, review: levels.l2, unstudied: levels.l0, percent, levels };
}
export function card(book: MyWordbook, events: LearningEvent[]): MyWordbookCard {
  const { words: _words, deletedAt: _deletedAt, ...rest } = book;
  return { ...clone(rest), wordCount: book.words.length, progress: progress(book, events) };
}
export function sameMeanings(left: StudyWordEntry["meanings"], right: StudyWordEntry["meanings"]): StudyWordEntry["meanings"] {
  // Dedupe on (pos, definition); the length-prefix keeps the boundary unambiguous so no pair collides.
  const key = (meaning: StudyMeaning): string => `${meaning.pos.length}:${meaning.pos}:${meaning.definition}`;
  const existing = new Set(left.map(key));
  return [...clone(left), ...right.filter((meaning) => !existing.has(key(meaning))).map(clone)];
}

/** Direct id reads/actions reach public entries or the owner; unlisted is share-code only. */
export function visibleTo(book: CatalogWordbook, clientId: string): boolean {
  return book.visibility === "public" || book.ownerClientId === clientId;
}
/** Build a catalog card. Private source ids are exposed only on the owner's upload feed/cards. */
export function catalogCard(book: CatalogWordbook, client: ClientData, clientId: string, favoriteCount = 0): CatalogCard {
  const {
    words: _words, ownerClientId: _owner, sourceWordbookId: _source, authorUserId: _authorUserId,
    seedKey: _seedKey, legacyUses: _legacyUses, adopterClientIds: _adopterClientIds, ...rest
  } = book;
  return {
    ...clone(rest), wordCount: book.words.length,
    favoriteCount,
    favorited: client.favorites.includes(book.id),
    added: client.wordbooks.some((item) => !item.deletedAt && item.sourceCatalogId === book.id),
    uploaded: book.ownerClientId === clientId,
    ...(book.ownerClientId === clientId && book.sourceWordbookId ? { sourceWordbookId: book.sourceWordbookId } : {}),
  };
}

/** Fold curly apostrophes in stored word text so it matches today's normalizeWord output. */
export function foldApostrophes(word: string): string { return word.replace(/[’ʼ]/g, "'"); }

/** Upgrade older JSON without losing wordbooks, events, publishing data, accounts, or visibility. */
export function migrate(raw: unknown): State {
  if (!isJsonObject(raw) || !Array.isArray(raw.catalog) || !isJsonObject(raw.clients)) throw new Error("Study data file has an unsupported format");
  if (raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5) throw new Error("Study data file has an unsupported format");
  const state = raw as unknown as State;
  state.version = 5;
  // Accounts and sessions are newer than the on-disk document; default them so older files load.
  state.users ??= [];
  state.sessions ??= [];
  for (const user of state.users) {
    if (user.role !== "admin") user.role = "user";
  }
  for (const book of state.catalog) {
    // Existing/legacy catalog entries predate visibility; the marketplace treats them as public.
    book.visibility ??= "public";
    for (const word of book.words ?? []) word.word = foldApostrophes(word.word);
  }
  for (const clientValue of Object.values(state.clients)) {
    const client = clientValue as ClientData;
    client.favorites ??= [];
    client.wordbooks ??= [];
    client.events ??= [];
    client.drafts ??= [];
    for (const book of client.wordbooks) {
      book.words ??= [];
      for (const word of book.words) {
        word.word = foldApostrophes(word.word);
        if (!word.id || typeof word.id !== "string") word.id = randomUUID();
        if (!word.addedAt || typeof word.addedAt !== "string") word.addedAt = book.createdAt;
        if (word.zhMeaningSource !== "user" && word.zhMeaningSource !== "dictionary") {
          delete word.zhMeaningSource;
        }
        if (typeof word.zhMeaning !== "string" || !word.zhMeaning.trim()) delete word.zhMeaning;
      }
    }
    client.events = client.events.map((event) => {
      const legacy = event as unknown as { wordbookId?: string; word?: string; wordId?: string };
      const legacyWord = legacy.word === undefined ? undefined : foldApostrophes(legacy.word);
      const book = client.wordbooks.find((item) => item.id === legacy.wordbookId);
      const matched = book?.words.find((item) => item.id === legacy.wordId || item.word === legacyWord);
      return { ...event, word: matched?.word ?? legacyWord ?? "", wordId: matched?.id ?? legacy.wordId ?? randomUUID() } as LearningEvent;
    });
    for (const draft of client.drafts) {
      draft.status ??= "pending";
      draft.groupId ??= `group-${randomUUID()}`;
      draft.entries ??= [];
      for (const entry of draft.entries) {
        if (entry.word) entry.word = foldApostrophes(entry.word);
        if (entry.entry) entry.entry.word = foldApostrophes(entry.entry.word);
      }
    }
  }
  // Build a durable adoption ledger from every surviving catalog-derived copy.
  // `legacyUses` preserves adopters whose copies were already purged and therefore
  // cannot be tied back to a client identity during migration.
  const holders = new Map<string, Set<string>>();
  for (const [clientId, client] of Object.entries(state.clients)) {
    for (const wordbook of client.wordbooks) {
      if (!wordbook.sourceCatalogId) continue;
      const ids = holders.get(wordbook.sourceCatalogId) ?? new Set<string>();
      ids.add(clientId);
      holders.set(wordbook.sourceCatalogId, ids);
    }
  }
  for (const book of state.catalog) {
    const known = new Set(book.adopterClientIds ?? []);
    for (const clientId of holders.get(book.id) ?? []) known.add(clientId);
    book.legacyUses ??= Math.max(0, book.uses - known.size);
    book.adopterClientIds = [...known];
    book.uses = Math.max(book.uses, book.legacyUses + known.size);
  }
  return state;
}
