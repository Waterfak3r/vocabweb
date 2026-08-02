import { createHash, randomUUID } from "node:crypto";
import { isJsonObject } from "./validation.js";
import { catalogDiffStats, diffCatalogWords } from "./collaboration.js";
import type {
  AccountUser, CatalogCard, CatalogContribution, CatalogRevision, CatalogRevisionSummary, CatalogWordbook, ImportDraft, LearningEvent, LevelCounts, MyWordbook, MyWordbookCard,
  ReviewSchedule, StudiedWord, StudyMeaning, StudyRound, StudyWordEntry, LearningQueueItem, SyncedStudySettings,
  WordLearningStatus, WordLevel, WordbookProgress, WordbookStudyPreferences, WordbookWord,
} from "./types.js";

/** Per-anonymous-client data home: favorites, private wordbooks, learning events, and import drafts. */
export interface ClientData {
  favorites: string[];
  wordbooks: MyWordbook[];
  events: LearningEvent[];
  drafts: ImportDraft[];
  /** Global learning experience settings; absent before the first server sync. */
  studySettings?: SyncedStudySettings;
  /** In-progress flashcard rounds. Account clients share this queue across devices. */
  studyRounds: StudyRound[];
}
/** A persisted session: the sha256 of the cookie token, its owner, and expiry. */
export interface SessionRecord { tokenHash: string; userId: string; expiresAt: string; createdAt: string; }
/** The whole persisted world. SQLite splits this across tables; JSON/memory keep it as one document. */
export interface State {
  version: 3 | 4 | 5 | 6;
  catalog: CatalogWordbook[];
  revisions: CatalogRevision[];
  contributions: CatalogContribution[];
  clients: Record<string, ClientData>;
  users: AccountUser[];
  sessions: SessionRecord[];
}
export const EMPTY = (): State => ({ version: 6, catalog: [], revisions: [], contributions: [], clients: {}, users: [], sessions: [] });
export const RETENTION_MS = 90 * 86_400_000;
export const BATCH_SIZE = 500;

export function clone<T>(value: T): T { return structuredClone(value); }
export function day(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function shiftDay(now: Date, offset: number): Date { const result = new Date(now); result.setDate(now.getDate() + offset); return result; }
/** Whole local calendar days from `from` to `to`, DST-safe: both are collapsed to local midnight and the gap is rounded, so a ±1h DST shift never miscounts. */
export function dayDiff(from: Date, to: Date): number { return Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000); }
export function toWordbookWords(words: StudyWordEntry[], at: string): WordbookWord[] { return words.map((word) => ({ ...clone(word), id: randomUUID(), addedAt: at })); }
export function toCatalogWords(words: WordbookWord[]): StudyWordEntry[] { return words.map(({ id: _id, addedAt: _addedAt, ...word }) => clone(word)); }
export function defaultClient(): ClientData { return { favorites: [], wordbooks: [], events: [], drafts: [], studyRounds: [] }; }

export interface WordLadderState {
  level: WordLevel;
  levelReachedAt?: string;
  lastStudiedAt?: string;
  recognitionStreak: 0 | 1 | 2;
  reviewIntervalDays: number;
  nextReviewAt?: string;
  /** Internal replay state: lower values make the interval recover more cautiously after lapses. */
  easeFactor: number;
  /** A failed recall has been seen and the next success is same-cycle relearning, not interval growth. */
  relearning: boolean;
}

const DAY_MS = 86_400_000;
const DEFAULT_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
export const DEFAULT_REVIEW_SCHEDULE: ReviewSchedule = {
  learningDays: 1,
  familiarDays: 3,
  masteredDays: 7,
  expertDays: 21,
  lapseDays: 1,
  maxDays: 60,
};
export const DEFAULT_WORDBOOK_STUDY_PREFERENCES: WordbookStudyPreferences = {
  plan: { newWords: 20, dictation: 15, backlogReviews: 50 },
  modes: {
    new: {
      meaningPreference: "zh",
      showExamples: true,
      showPhonetic: true,
      autoPlayAudio: false,
      exerciseTypes: ["self-rating", "meaning-choice"],
    },
    review: {
      meaningPreference: "zh",
      showExamples: true,
      showPhonetic: true,
      autoPlayAudio: false,
      exerciseTypes: ["self-rating", "meaning-choice"],
    },
    dictation: {
      meaningPreference: "zh",
      showExamples: true,
      showPhonetic: true,
      autoPlayAudio: false,
      underlineMistakes: true,
      showMeaning: true,
      showCharacterMask: false,
    },
  },
};

export function reviewScheduleOf(book: Pick<MyWordbook, "reviewSchedule">): ReviewSchedule {
  return clone(book.reviewSchedule ?? DEFAULT_REVIEW_SCHEDULE);
}

function intervalForLevel(schedule: ReviewSchedule, level: WordLevel): number {
  return level === 0 ? 0
    : level === 1 ? schedule.learningDays
      : level === 2 ? schedule.familiarDays
        : level === 3 ? schedule.masteredDays
          : schedule.expertDays;
}

function nextReviewAt(occurredAt: string, intervalDays: number): string {
  return new Date(Date.parse(occurredAt) + intervalDays * DAY_MS).toISOString();
}

function dueAt(state: Pick<WordLadderState, "level" | "nextReviewAt">, at: string): boolean {
  if (state.level === 0 || state.nextReviewAt === undefined) return false;
  const due = Date.parse(state.nextReviewAt);
  const current = Date.parse(at);
  return !Number.isFinite(due) || !Number.isFinite(current) || current >= due;
}

function grownInterval(current: number, ease: number, dictation: boolean, schedule: ReviewSchedule): number {
  const bonus = dictation ? 1.15 : 1;
  return Math.min(schedule.maxDays, Math.max(current + 1, Math.round(Math.max(1, current) * ease * bonus)));
}

/**
 * Replay one word's full event history into its proficiency ladder state. Events must arrive
 * oldest-first (ties keep insertion order). `levelReachedAt` is the occurredAt of the event that
 * last CHANGED the level; a "mark" always counts as a change, even to the same rung.
 *
 * The review clock uses an adaptive expanding interval. On-time successful recall grows the
 * interval; early practice preserves the existing due date; a lapse contracts it to the
 * wordbook's configured short checkpoint.
 * Everything is derived from the existing event log, so persisted users migrate automatically.
 */
export function replayLadder(
  events: LearningEvent[],
  onEvent?: (event: LearningEvent, level: WordLevel) => void,
  schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE,
): WordLadderState {
  let level: WordLevel = 0;
  let levelReachedAt: string | undefined;
  let recognitionStreak: 0 | 1 | 2 = 0;
  let reviewIntervalDays = 0;
  let scheduledReviewAt: string | undefined;
  let easeFactor = DEFAULT_EASE;
  let relearning = false;
  for (const event of events) {
    const previous: WordLevel = level;
    const wasDue = dueAt({ level, nextReviewAt: scheduledReviewAt }, event.occurredAt);
    let successfulRecall = false;
    let failedRecall = false;
    let manualSchedule = false;
    let restoredState = false;
    switch (event.kind) {
      case "new":
        // One honest first-pass judgment is enough to enter spaced review. Repeating the same
        // card several times in one sitting is not evidence of retention; the configured
        // learning interval provides the meaningful follow-up instead. Legacy verdict-less
        // events still count as "know", preserving forward progress.
        if (level === 0) {
          if (event.verdict === "unknown" || event.verdict === "vague") recognitionStreak = 0;
          else {
            level = 1;
            recognitionStreak = 0;
            successfulRecall = true;
          }
        }
        break;
      case "flashcard": // 认识 climbs; 模糊 keeps the rung but contracts the checkpoint; 不认识 demotes.
        if (event.verdict === "know") {
          level = level < 2 ? (level + 1) as WordLevel : level;
          successfulRecall = true;
        } else if (event.verdict === "vague") {
          // A fuzzy recall is not a proficiency failure, but it is weak enough to schedule a
          // short follow-up and to make the successful retry a same-cycle recovery.
          failedRecall = true;
        } else {
          level = Math.max(1, level - 1) as WordLevel;
          failedRecall = true;
        }
        break;
      case "dictation":
        if (event.correct) {
          // L2 → L3 at once. L3 → L4 requires a due interval of at least seven days, preventing
          // a one-day lapse-recovery cycle from being mistaken for long-term mastery.
          if (level === 2) level = 3;
          else if (level === 3 && wasDue && reviewIntervalDays >= schedule.masteredDays) level = 4;
          successfulRecall = level > 0;
        } else {
          level = Math.max(1, level - 1) as WordLevel;
          failedRecall = true;
        }
        break;
      case "mark": // Manual override to an exact rung.
        level = event.level;
        if (event.retainedState) {
          recognitionStreak = event.retainedState.recognitionStreak;
          reviewIntervalDays = event.retainedState.reviewIntervalDays;
          scheduledReviewAt = event.retainedState.nextReviewAt;
          easeFactor = event.retainedState.easeFactor;
          relearning = event.retainedState.relearning;
          levelReachedAt = event.retainedState.levelReachedAt;
          restoredState = true;
        } else {
          recognitionStreak = 0;
          manualSchedule = true;
        }
        break;
    }
    if (!restoredState && (level !== previous || event.kind === "mark")) levelReachedAt = event.occurredAt;

    if (restoredState) {
      // A retained baseline already contains the complete adaptive state at this instant.
    } else if (manualSchedule) {
      easeFactor = DEFAULT_EASE;
      relearning = false;
      reviewIntervalDays = intervalForLevel(schedule, level);
      scheduledReviewAt = level === 0 ? undefined : nextReviewAt(event.occurredAt, reviewIntervalDays);
    } else if (level === 0) {
      reviewIntervalDays = 0;
      scheduledReviewAt = undefined;
      relearning = false;
    } else if (failedRecall) {
      const fuzzy = event.kind === "flashcard" && event.verdict === "vague";
      easeFactor = Math.max(MIN_EASE, Number((easeFactor - (fuzzy ? 0.1 : 0.2)).toFixed(2)));
      reviewIntervalDays = schedule.lapseDays;
      scheduledReviewAt = nextReviewAt(event.occurredAt, reviewIntervalDays);
      relearning = true;
    } else if (successfulRecall) {
      if (relearning) {
        // The current session may ask again after a miss. That successful retry restores the rung
        // but keeps the configured short checkpoint instead of erasing the lapse.
        relearning = false;
      } else if (level !== previous) {
        reviewIntervalDays = intervalForLevel(schedule, level);
        scheduledReviewAt = nextReviewAt(event.occurredAt, reviewIntervalDays);
      } else if (wasDue) {
        easeFactor = Math.min(MAX_EASE, Number((easeFactor + (event.kind === "dictation" ? 0.1 : 0.05)).toFixed(2)));
        reviewIntervalDays = grownInterval(reviewIntervalDays, easeFactor, event.kind === "dictation", schedule);
        scheduledReviewAt = nextReviewAt(event.occurredAt, reviewIntervalDays);
      }
    }
    onEvent?.(event, level);
  }
  // Events arrive oldest-first, so the tail is the most recent touch of ANY kind (mark included) —
  // retained for activity display and compatibility. The adaptive due rule uses nextReviewAt.
  const lastStudiedAt = events.length ? events[events.length - 1]!.occurredAt : undefined;
  return {
    level,
    recognitionStreak,
    reviewIntervalDays,
    easeFactor,
    relearning,
    ...(levelReachedAt !== undefined ? { levelReachedAt } : {}),
    ...(lastStudiedAt !== undefined ? { lastStudiedAt } : {}),
    ...(scheduledReviewAt !== undefined ? { nextReviewAt: scheduledReviewAt } : {}),
  };
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

/**
 * Replace detailed events older than the retention window with one replayable baseline per word.
 * This keeps activity retention bounded without resetting proficiency when a learner returns after
 * a long absence. Retained marks are internal and filtered from recent activity by the store.
 */
export function compactLearningEvents(
  events: LearningEvent[],
  cutoff: number,
  scheduleForWordbook: (wordbookId: string) => ReviewSchedule = () => DEFAULT_REVIEW_SCHEDULE,
): LearningEvent[] {
  const expired = events.filter((event) => Date.parse(event.occurredAt) < cutoff);
  if (!expired.length) return events;
  const retained = events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
  const checkpoints: LearningEvent[] = [];
  for (const bucket of bucketByWord(expired).values()) {
    const tail = bucket.at(-1);
    if (!tail) continue;
    const state = replayLadder(bucket, undefined, scheduleForWordbook(tail.wordbookId));
    checkpoints.push({
      id: `retained-${tail.wordbookId}-${tail.wordId}`,
      kind: "mark",
      wordbookId: tail.wordbookId,
      wordId: tail.wordId,
      word: tail.word,
      level: state.level,
      occurredAt: tail.occurredAt,
      retainedState: {
        recognitionStreak: state.recognitionStreak,
        reviewIntervalDays: state.reviewIntervalDays,
        easeFactor: state.easeFactor,
        relearning: state.relearning,
        ...(state.levelReachedAt !== undefined ? { levelReachedAt: state.levelReachedAt } : {}),
        ...(state.nextReviewAt !== undefined ? { nextReviewAt: state.nextReviewAt } : {}),
      },
    });
  }
  return [...checkpoints, ...retained];
}

export function ladderStates(events: LearningEvent[], schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE): Map<string, WordLadderState> {
  const states = new Map<string, WordLadderState>();
  for (const [wordId, bucket] of bucketByWord(events)) states.set(wordId, replayLadder(bucket, undefined, schedule));
  return states;
}
/** Level each word held right AFTER each event, keyed by event id — feeds recentActivity honesty. */
export function ladderEventLevels(events: LearningEvent[], schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE): Map<string, WordLevel> {
  const after = new Map<string, WordLevel>();
  for (const bucket of bucketByWord(events).values()) replayLadder(bucket, (event, level) => after.set(event.id, level), schedule);
  return after;
}
export function ladderOf(states: Map<string, WordLadderState>, wordId: string): WordLadderState {
  return states.get(wordId) ?? { level: 0, recognitionStreak: 0, reviewIntervalDays: 0, easeFactor: DEFAULT_EASE, relearning: false };
}
// Legacy 4-status compat kept for the ?status= filter: L0 new / L1 learning / L2 review / L3-L4 mastered.
function statusFromLevel(level: WordLevel): WordLearningStatus { return level === 0 ? "new" : level === 1 ? "learning" : level === 2 ? "review" : "mastered"; }
function studiedWordOf(word: WordbookWord, state: WordLadderState): StudiedWord {
  return {
    ...clone(word),
    level: state.level,
    recognitionStreak: state.recognitionStreak,
    reviewIntervalDays: state.reviewIntervalDays,
    ...(state.levelReachedAt !== undefined ? { levelReachedAt: state.levelReachedAt } : {}),
    ...(state.lastStudiedAt !== undefined ? { lastStudiedAt: state.lastStudiedAt } : {}),
    ...(state.nextReviewAt !== undefined ? { nextReviewAt: state.nextReviewAt } : {}),
  };
}
export { studiedWordOf as studiedWord };
export function queueItem(word: WordbookWord, state: WordLadderState): LearningQueueItem { return { ...studiedWordOf(word, state), status: statusFromLevel(state.level) }; }
/**
 * Every learned word remains in long-term spaced review, including L3/L4. Modern replayed states
 * carry an exact due instant; the calendar-day fallback keeps hand-built/legacy states usable.
 */
export function reviewDue(state: WordLadderState, now: Date, schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE): boolean {
  if (state.level === 0) return false;
  if (state.nextReviewAt !== undefined) {
    const due = Date.parse(state.nextReviewAt);
    return !Number.isFinite(due) || now.getTime() >= due;
  }
  if (state.lastStudiedAt === undefined) return true;
  const interval = state.reviewIntervalDays || intervalForLevel(schedule, state.level);
  return dayDiff(new Date(state.lastStudiedAt), now) >= interval;
}
export type ReviewLane = "protected" | "regular" | "backlog";
/**
 * Split due work by urgency. A short-interval word is protected only while its checkpoint is
 * still timely; once it has been ignored for long enough it becomes historical backlog. This
 * prevents months-old debt from displacing the first reviews of words learned this week.
 */
export function reviewLane(
  state: WordLadderState,
  now: Date,
  schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE,
): ReviewLane | null {
  if (!reviewDue(state, now, schedule)) return null;
  const interval = state.reviewIntervalDays || intervalForLevel(schedule, state.level);
  const due = state.nextReviewAt ? new Date(state.nextReviewAt) : state.lastStudiedAt
    ? shiftDay(new Date(state.lastStudiedAt), interval)
    : new Date(0);
  const overdueDays = Number.isFinite(due.getTime()) ? Math.max(0, dayDiff(due, now)) : Number.POSITIVE_INFINITY;
  if (overdueDays > Math.max(7, interval * 2)) return "backlog";
  if (state.relearning || interval <= Math.max(3, schedule.familiarDays)) return "protected";
  return "regular";
}
export function progress(book: MyWordbook, events: LearningEvent[]): WordbookProgress {
  const states = ladderStates(events, reviewScheduleOf(book));
  const levels: LevelCounts = { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 };
  for (const word of book.words) levels[`l${ladderOf(states, word.id).level}` as keyof LevelCounts] += 1;
  const total = book.words.length;
  const percent = total ? Math.round(((levels.l1 * 0.25 + levels.l2 * 0.5 + levels.l3 * 0.75 + levels.l4) / total) * 100) : 0;
  return { mastered: levels.l3 + levels.l4, learning: levels.l1, review: levels.l2, unstudied: levels.l0, percent, levels };
}
export function card(book: MyWordbook, events: LearningEvent[]): MyWordbookCard {
  const { words: _words, deletedAt: _deletedAt, ...rest } = book;
  return { ...clone(rest), reviewSchedule: reviewScheduleOf(book), wordCount: book.words.length, progress: progress(book, events) };
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
export function catalogCard(
  book: CatalogWordbook,
  client: ClientData,
  clientId: string,
  favoriteCount = 0,
  collaboration: {
    enabled?: boolean;
    openContributionCount?: number;
    latestRevision?: CatalogRevisionSummary;
  } = {},
): CatalogCard {
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
    collaborationEnabled: collaboration.enabled ?? false,
    openContributionCount: collaboration.openContributionCount ?? 0,
    ...(collaboration.latestRevision ? { latestRevision: clone(collaboration.latestRevision) } : {}),
    ...(book.ownerClientId === clientId && book.sourceWordbookId ? { sourceWordbookId: book.sourceWordbookId } : {}),
  };
}

/** Fold curly apostrophes in stored word text so it matches today's normalizeWord output. */
export function foldApostrophes(word: string): string { return word.replace(/[’ʼ]/g, "'"); }

/** Upgrade older JSON without losing wordbooks, events, publishing data, accounts, or visibility. */
export function migrate(raw: unknown): State {
  if (!isJsonObject(raw) || !Array.isArray(raw.catalog) || !isJsonObject(raw.clients)) throw new Error("Study data file has an unsupported format");
  if (raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5 && raw.version !== 6) throw new Error("Study data file has an unsupported format");
  const state = raw as unknown as State;
  state.version = 6;
  // Accounts and sessions are newer than the on-disk document; default them so older files load.
  state.users ??= [];
  state.sessions ??= [];
  state.revisions ??= [];
  state.contributions ??= [];
  for (const user of state.users) {
    if (user.role !== "admin") user.role = "user";
  }
  for (const book of state.catalog) {
    // Existing/legacy catalog entries predate visibility; the marketplace treats them as public.
    book.visibility ??= "public";
    book.updatedAt ??= book.createdAt;
    for (const word of book.words ?? []) word.word = foldApostrophes(word.word);
    let head = book.headRevisionId
      ? state.revisions.find((revision) => revision.id === book.headRevisionId && revision.catalogId === book.id)
      : undefined;
    if (!head) {
      const id = `revision-${createHash("sha256").update(`initial:${book.id}`).digest("hex").slice(0, 32)}`;
      head = state.revisions.find((revision) => revision.id === id);
      if (!head) {
        const changes = diffCatalogWords([], book.words ?? []);
        head = {
          id,
          catalogId: book.id,
          kind: "initial",
          message: "首次发布",
          ...(book.authorUserId ? { authorUserId: book.authorUserId } : {}),
          author: book.author || "匿名",
          createdAt: book.createdAt,
          changes,
          stats: catalogDiffStats(changes),
        };
        state.revisions.push(head);
      }
      book.headRevisionId = head.id;
    }
  }
  for (const clientValue of Object.values(state.clients)) {
    const client = clientValue as ClientData;
    client.favorites ??= [];
    client.wordbooks ??= [];
    client.events ??= [];
    client.drafts ??= [];
    client.studyRounds ??= [];
    if (client.studySettings) {
      const shortcuts = client.studySettings.shortcuts as SyncedStudySettings["shortcuts"] & { vague?: string; mastered?: string };
      shortcuts.vague ??= ["w", "v", "r", "f"].find(
        (key) => ![shortcuts.unknown, shortcuts.pronounce, shortcuts.known, shortcuts.flip].includes(key),
      ) ?? "w";
      shortcuts.mastered ??= ["r", "f", "x", "c", "z", "1", "2", "3", "4", "5"].find(
        (key) => ![shortcuts.unknown, shortcuts.vague, shortcuts.pronounce, shortcuts.known, shortcuts.flip].includes(key),
      ) ?? "r";
    }
    for (const book of client.wordbooks) {
      book.words ??= [];
      if (book.studyPreferences) {
        book.studyPreferences.plan.backlogReviews ??= DEFAULT_WORDBOOK_STUDY_PREFERENCES.plan.backlogReviews;
        const newMode = book.studyPreferences.modes.new as typeof book.studyPreferences.modes.new & { exerciseTypes?: typeof DEFAULT_WORDBOOK_STUDY_PREFERENCES.modes.new.exerciseTypes };
        const reviewMode = book.studyPreferences.modes.review as typeof book.studyPreferences.modes.review & { exerciseTypes?: typeof DEFAULT_WORDBOOK_STUDY_PREFERENCES.modes.review.exerciseTypes };
        newMode.exerciseTypes ??= clone(DEFAULT_WORDBOOK_STUDY_PREFERENCES.modes.new.exerciseTypes);
        reviewMode.exerciseTypes ??= clone(DEFAULT_WORDBOOK_STUDY_PREFERENCES.modes.review.exerciseTypes);
      }
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
    for (const round of client.studyRounds) round.masteredWordIds ??= [];
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
