export const WORD_SOURCES = ["backend", "dictionary-api", "local-ielts", "user"] as const;
export type WordSource = (typeof WORD_SOURCES)[number];
export type ZhMeaningSource = "user" | "dictionary";
export type CatalogExam = "IELTS" | "TOEFL" | "GRE" | "高考" | "四级" | "六级" | "四六级" | "考研";
export type LearningGoal = "写作" | "阅读" | "听力" | "口语";
export type CatalogSort = "recommended" | "hot" | "newest" | "rating";
/** Marketplace listing scope. Existing/legacy entries migrate to "public". */
export type CatalogVisibility = "public" | "unlisted" | "private";

export interface StudyMeaning { pos: string; definition: string; example?: string; }
/** English dictionary fields are deliberately separate from a learner's Chinese note. */
export interface StudyWordEntry {
  word: string; phonetic: string; audioUrl?: string; meanings: StudyMeaning[]; source: WordSource;
  zhMeaning?: string; zhMeaningSource?: ZhMeaningSource;
}
/** `id` never changes, including when the learner corrects the English spelling. */
export interface WordbookWord extends StudyWordEntry { id: string; addedAt: string; }

export interface CatalogWordbook {
  id: string; title: string; description: string; author: string;
  exams: CatalogExam[]; goals: LearningGoal[]; rating: number; uses: number;
  createdAt: string; shareCode: string; words: StudyWordEntry[]; ownerClientId?: string;
  /** Listing scope; `author` is the display name ("匿名" for anonymous uploads). */
  visibility: CatalogVisibility;
  /** Set when an authenticated account owns the entry; absent for anonymous/legacy uploads. */
  authorUserId?: string;
  /** Points at the owner's private source only; `words` is always a publish-time snapshot. */
  sourceWordbookId?: string;
  /** Stable internal identity for deployment-provided catalog content. */
  seedKey?: string;
  /** Historical adopters whose identity predates the adoption ledger. */
  legacyUses?: number;
  /** Internal client identities already counted toward `uses`. */
  adopterClientIds?: string[];
}
export type CatalogCard = Omit<CatalogWordbook, "words" | "ownerClientId" | "sourceWordbookId" | "authorUserId" | "seedKey" | "legacyUses" | "adopterClientIds"> & {
  wordCount: number; favoriteCount: number; favorited: boolean; added: boolean; uploaded: boolean;
  /** Only exposed to the owner, so the upload UI can refresh the correct private source. */
  sourceWordbookId?: string;
};
export type CatalogDetail = CatalogCard & { words: StudyWordEntry[]; };
export interface MyWordbook {
  id: string; title: string; description: string; sourceCatalogId?: string;
  category?: string; createdAt: string; updatedAt: string; deletedAt?: string; words: WordbookWord[];
  /** Omitted by legacy data; the default adaptive schedule is resolved at read time. */
  reviewSchedule?: ReviewSchedule;
  /** Omitted until a legacy browser's local preferences have been migrated to the server. */
  studyPreferences?: WordbookStudyPreferences;
}
export interface MyWordbookCard {
  id: string; title: string; description: string; sourceCatalogId?: string; category?: string; createdAt: string; updatedAt: string;
  wordCount: number; progress: WordbookProgress; reviewSchedule: ReviewSchedule;
  studyPreferences?: WordbookStudyPreferences;
}

/** Proficiency ladder: 0 未学习 / 1 初识 / 2 熟悉 / 3 掌握 / 4 精通. */
export type WordLevel = 0 | 1 | 2 | 3 | 4;
export const LEVEL_NAMES: Record<WordLevel, string> = { 0: "未学习", 1: "初识", 2: "熟悉", 3: "掌握", 4: "精通" };
export type LearningVerdict = "know" | "vague" | "unknown";

export type LearningEventInput =
  | { kind: "new"; wordbookId: string; word?: string; wordId?: string; verdict?: LearningVerdict }
  | { kind: "flashcard"; wordbookId: string; word?: string; wordId?: string; verdict: LearningVerdict }
  | { kind: "dictation"; wordbookId: string; word?: string; wordId?: string; correct: boolean }
  | { kind: "mark"; wordbookId: string; word?: string; wordId?: string; level: WordLevel };
export interface RetainedReviewState {
  levelReachedAt?: string;
  recognitionStreak: 0 | 1 | 2;
  reviewIntervalDays: number;
  nextReviewAt?: string;
  easeFactor: number;
  relearning: boolean;
}
export type LearningEvent =
  | ({ kind: "new"; wordbookId: string; word: string; wordId: string; verdict?: LearningVerdict; id: string; occurredAt: string })
  | ({ kind: "flashcard"; wordbookId: string; word: string; wordId: string; verdict: LearningVerdict; id: string; occurredAt: string })
  | ({ kind: "dictation"; wordbookId: string; word: string; wordId: string; correct: boolean; id: string; occurredAt: string })
  | ({
      kind: "mark"; wordbookId: string; word: string; wordId: string; level: WordLevel; id: string; occurredAt: string;
      /** Internal compacted baseline; never accepted from the public event endpoint or shown as activity. */
      retainedState?: RetainedReviewState;
    });
export type WordLearningStatus = "new" | "learning" | "review" | "mastered";
export interface LevelCounts { l0: number; l1: number; l2: number; l3: number; l4: number; }
export interface WordbookProgress { mastered: number; learning: number; review: number; unstudied: number; percent: number; levels: LevelCounts; }
/** Per-wordbook adaptive review plan. Intervals are positive, monotonic integer day counts. */
export interface ReviewSchedule {
  learningDays: number;
  familiarDays: number;
  masteredDays: number;
  expertDays: number;
  lapseDays: number;
  maxDays: number;
}
export type MeaningPreference = "zh" | "en";
export interface StudyDisplayPreferences {
  meaningPreference: MeaningPreference;
  showExamples: boolean;
  showPhonetic: boolean;
  autoPlayAudio: boolean;
}
export type StudyExerciseType = "self-rating" | "meaning-choice";
export interface FlashcardDisplayPreferences extends StudyDisplayPreferences {
  /** At least one exercise is enabled. When both are selected, every word must pass both. */
  exerciseTypes: StudyExerciseType[];
}
export interface DictationDisplayPreferences extends StudyDisplayPreferences {
  underlineMistakes: boolean;
  showMeaning: boolean;
  showCharacterMask: boolean;
}
export interface WordbookStudyPreferences {
  plan: { newWords: number; dictation: number; backlogReviews: number };
  modes: {
    new: FlashcardDisplayPreferences;
    review: FlashcardDisplayPreferences;
    dictation: DictationDisplayPreferences;
  };
}
export type StudyShortcutAction = "unknown" | "vague" | "pronounce" | "known" | "flip" | "dictationPronounce";
export type StudyShortcutPreferences = Record<StudyShortcutAction, string>;
export interface PronunciationPreferences { accent: "gb" | "us"; }
/** Account/client-wide settings shared by every wordbook and browser. */
export interface SyncedStudySettings {
  shortcuts: StudyShortcutPreferences;
  pronunciation: PronunciationPreferences;
  updatedAt: string;
}
export interface UpdateStudySettingsInput {
  shortcuts?: StudyShortcutPreferences;
  pronunciation?: PronunciationPreferences;
}
/**
 * A stored word plus its replayed proficiency. `levelReachedAt` is omitted while still at L0;
 * `nextReviewAt` and `reviewIntervalDays` are derived from the event history, so old data gains the
 * adaptive schedule without a persistence migration.
 */
export type StudiedWord = WordbookWord & {
  level: WordLevel;
  levelReachedAt?: string;
  lastStudiedAt?: string;
  /** Current adaptive interval. Zero means the word has not entered spaced review yet. */
  reviewIntervalDays: number;
  /** Exact next due instant. Omitted only while the word remains unstudied at L0. */
  nextReviewAt?: string;
  /** Legacy compatibility field; new learning now enters L1 after one honest recognition. */
  recognitionStreak: 0 | 1 | 2;
};
export interface LearningQueueItem extends StudiedWord { status: WordLearningStatus; }

export interface StudyDashboard {
  wordbook: MyWordbookCard;
  todayPlan: {
    new: { target: number; completed: number };
    review: { target: number; completed: number };
    dictation: { target: number; completed: number };
  };
  /** Each entry carries the proficiency level the word held right after that event. */
  recentActivity: Array<LearningEvent & { levelAfter: WordLevel }>;
  calendar: Array<{ date: string; count: number; active: boolean }>;
  week: { newCount: number; reviewCount: number; dictationCount: number; total: number };
  streakDays: number;
  /** Due reviews are split so stale backlog cannot crowd out time-sensitive early consolidation. */
  reviewBreakdown: { protected: number; regular: number; backlog: number; scheduled: number };
  /** Live 24-hour snapshots let another device offer an exact resume entry point. */
  activeRounds: Array<{ id: string; mode: StudyRoundMode; scope: StudyRoundScope; remainingWords: number; updatedAt: string }>;
  /** Due L3 words whose next successful dictation can complete the final proficiency step. */
  finalCheckDue: number;
  updatedAt: string;
}

export type StudyRoundMode = "new" | "review";
export type StudyRoundScope = "standard" | "backlog" | "ahead";
export interface StudyRoundTask {
  id: string;
  wordId: string;
  exercise: StudyExerciseType;
}
/** Durable in-progress queue shared by all devices signed into the same account. */
export interface StudyRound {
  id: string;
  wordbookId: string;
  mode: StudyRoundMode;
  scope: StudyRoundScope;
  meaningPreference: MeaningPreference;
  exerciseTypes: StudyExerciseType[];
  wordIds: string[];
  queue: StudyRoundTask[];
  passedTaskKeys: string[];
  completedWordIds: string[];
  vagueWordIds: string[];
  unknownWordIds: string[];
  processedOperationIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt?: string;
}
export interface StartStudyRoundInput {
  wordbookId: string;
  mode: StudyRoundMode;
  scope?: StudyRoundScope;
}
export interface StudyRoundAnswerInput {
  taskId: string;
  response: LearningVerdict | "correct" | "incorrect";
  operationId: string;
  revision: number;
}
export interface StudyChoiceOption {
  /** The source word is revealed only after the learner chooses an option. */
  wordId: string;
  word: string;
  pos: string;
  definition: string;
}
export interface StudyRoundTaskOptions {
  taskId: string;
  wordId: string;
  options: StudyChoiceOption[];
}
export type StudyRoundMutationResult =
  | { kind: "updated"; round: StudyRound }
  | { kind: "not-found" }
  | { kind: "conflict"; round: StudyRound };

export interface CatalogQuery { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort; }
export interface CreateMyWordbookInput { title: string; description?: string; category?: string; words?: StudyWordEntry[]; }
export interface UpdateMyWordbookInput {
  category?: string | null;
  reviewSchedule?: ReviewSchedule;
  studyPreferences?: WordbookStudyPreferences;
}
/** The uploading account, supplied by the auth layer; drives the author display name and authorUserId. */
export interface CatalogAuthor { userId: string; username: string; }
/** Legacy direct upload remains supported; modern uploads reference the private wordbook. */
export interface UploadCatalogWordbookInput extends Partial<CreateMyWordbookInput> {
  sourceWordbookId?: string; exams?: CatalogExam[]; goals?: LearningGoal[];
  /** Defaults to "public" in the store; "public" uploads must be authenticated (enforced by the route). */
  visibility?: CatalogVisibility; author?: CatalogAuthor;
}
export interface UpdateCatalogWordbookInput {
  sourceWordbookId?: string; title?: string; description?: string; exams?: CatalogExam[]; goals?: LearningGoal[];
  /** Switching TO "public" must be authenticated (enforced by the route), which also stamps the author. */
  visibility?: CatalogVisibility; author?: CatalogAuthor;
}

export type ImportEntryStatus = "processing" | "ready" | "invalid" | "duplicate" | "unmatched" | "conflict";
export type ImportResolution = "keep" | "replace" | "merge" | "discard";
export type ImportCommitMode = "append" | "overwrite";
export interface ImportLineInput {
  line: number; word: string; pos?: string; enDefinition?: string; zhMeaning?: string; example?: string;
}
export interface ImportDraftEntry {
  id: string; line: number; word?: string; pos?: string; enDefinition?: string; zhMeaning?: string; example?: string;
  status: ImportEntryStatus; reason?: string; conflictWith?: string; resolution?: ImportResolution;
  /** The normalized English data resolved by the server, if any. */
  entry?: StudyWordEntry;
}
export interface ImportDraft {
  id: string; groupId: string; title: string; description: string; targetWordbookId?: string;
  batchIndex: number; totalBatches: number; status: "processing" | "pending" | "committed";
  createdAt: string; updatedAt: string; committedAt?: string; entries: ImportDraftEntry[];
}
export interface CreateImportDraftInput {
  title: string; description?: string; targetWordbookId?: string; lines: ImportLineInput[];
}
export interface PreparedImportLine extends ImportLineInput {
  status: ImportEntryStatus; reason?: string; entry?: StudyWordEntry;
}
export interface ResolvedImportDraftEntry {
  id: string; status: "processing" | "ready" | "unmatched" | "invalid"; reason?: string; entry?: StudyWordEntry;
}
export interface CommitImportDraftInput { mode?: ImportCommitMode; resolutions?: Record<string, ImportResolution>; }
export interface UpdateWordInput {
  word?: string; zhMeaning?: string | null; phonetic?: string; audioUrl?: string | null; meanings?: StudyMeaning[];
}
export type UpdateWordResult = { kind: "updated"; word: StudiedWord } | { kind: "not-found" } | { kind: "duplicate" } | { kind: "lookup-failed" };
export type BatchWordAction = "refresh-meanings" | "delete" | "mark-mastered";
export interface BatchWordInput {
  action: BatchWordAction;
  wordIds: string[];
  /** Dictionary matches keyed by word id; used only for refresh-meanings. */
  rematched?: Record<string, StudyWordEntry>;
}
export interface BatchWordResult {
  action: BatchWordAction;
  succeededIds: string[];
  failed: Array<{ wordId: string; code: "WORD_NOT_FOUND" | "DICTIONARY_UNAVAILABLE" }>;
}

export type UserRole = "user" | "admin";
/** A registered account. `clientId` is the account's data home (the anonymous id adopted at registration). */
export interface AccountUser { id: string; username: string; passwordHash: string; clientId: string; role: UserRole; createdAt: string; }

/** Persistence seam: production SQLite is durable; tests inject the memory store. */
export interface StudyStore {
  // --- Accounts & sessions ---
  /** Case-insensitive username uniqueness; adopts `clientId` as the new account's data home. */
  createUser(username: string, passwordHash: string, clientId: string): Promise<{ kind: "created"; user: AccountUser } | { kind: "taken" } | { kind: "client-taken" }>;
  getUserByUsername(username: string): Promise<AccountUser | null>;
  getUserById(id: string): Promise<AccountUser | null>;
  getUserByClientId(clientId: string): Promise<AccountUser | null>;
  /** Changes an existing account's durable role. Intended for local administration tooling. */
  setUserRole(username: string, role: UserRole): Promise<AccountUser | null>;
  exportUserData(userId: string): Promise<unknown | null>;
  deleteUser(userId: string): Promise<boolean>;
  createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void>;
  /** Returns the session's user when live; an expired session yields null and is deleted. */
  getSession(tokenHash: string, now: Date): Promise<{ user: AccountUser; expiresAt: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Fold one client's data into another: append wordbooks/events/drafts, union favorites, reassign catalog ownership. No-op when ids match or the source is absent/empty. */
  mergeClients(fromClientId: string, intoClientId: string): Promise<void>;
  listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]>;
  listFavorites(clientId: string): Promise<CatalogCard[]>;
  listUploads(clientId: string): Promise<CatalogCard[]>;
  getCatalog(clientId: string, id: string): Promise<CatalogDetail | null>;
  toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean; favoriteCount: number } | null>;
  addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard | null>;
  upsertSeedCatalog(clientId: string, input: UploadCatalogWordbookInput & { seedKey: string; author: CatalogAuthor }): Promise<CatalogCard>;
  updateCatalog(clientId: string, id: string, input: UpdateCatalogWordbookInput): Promise<CatalogCard | null>;
  importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  getStudySettings(clientId: string): Promise<SyncedStudySettings | null>;
  updateStudySettings(clientId: string, input: UpdateStudySettingsInput): Promise<SyncedStudySettings>;
  listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]>;
  createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard>;
  updateMyWordbook(clientId: string, id: string, input: UpdateMyWordbookInput): Promise<MyWordbookCard | null>;
  getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  deleteMyWordbook(clientId: string, id: string): Promise<boolean>;
  restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null>;
  /** Exact normalized lookup across live private wordbooks; the most recently updated book wins. */
  findPersonalWord(clientId: string, word: string): Promise<StudyWordEntry | null>;
  addWordToMyWordbook(clientId: string, wordbookId: string, entry: StudyWordEntry): Promise<{ word: LearningQueueItem; created: boolean } | null>;
  purgeMyWordbook(clientId: string, id: string): Promise<boolean>;
  deleteCatalogUpload(clientId: string, id: string): Promise<boolean>;
  updateWord(clientId: string, wordbookId: string, wordId: string, input: UpdateWordInput, rematched?: StudyWordEntry, options?: { lookupFailed?: boolean }): Promise<UpdateWordResult>;
  batchWords(clientId: string, wordbookId: string, input: BatchWordInput): Promise<BatchWordResult | null>;
  createImportDrafts(clientId: string, input: CreateImportDraftInput): Promise<ImportDraft[]>;
  resolveImportDraftEntries(clientId: string, id: string, entries: ResolvedImportDraftEntry[]): Promise<ImportDraft | null>;
  listImportDrafts(clientId: string): Promise<ImportDraft[]>;
  getImportDraft(clientId: string, id: string): Promise<ImportDraft | null>;
  deleteImportDraft(clientId: string, id: string): Promise<boolean>;
  commitImportDraft(clientId: string, id: string, input: CommitImportDraftInput): Promise<MyWordbookCard | null>;
  startStudyRound(clientId: string, input: StartStudyRoundInput): Promise<{ round: StudyRound; resumed: boolean } | null>;
  getStudyRound(clientId: string, id: string): Promise<StudyRound | null>;
  getStudyRoundTaskOptions(
    clientId: string,
    id: string,
    taskId: string,
    meaningPreference?: MeaningPreference,
  ): Promise<StudyRoundTaskOptions | null>;
  rotateStudyRound(clientId: string, id: string, revision: number): Promise<StudyRoundMutationResult>;
  answerStudyRound(clientId: string, id: string, input: StudyRoundAnswerInput): Promise<StudyRoundMutationResult>;
  recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null>;
  getDashboard(clientId: string, id: string): Promise<StudyDashboard | null>;
}
