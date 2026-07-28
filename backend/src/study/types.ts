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
  createdAt: string; updatedAt: string; deletedAt?: string; words: WordbookWord[];
}
export interface MyWordbookCard {
  id: string; title: string; description: string; sourceCatalogId?: string; createdAt: string; updatedAt: string;
  wordCount: number; progress: WordbookProgress;
}

/** Proficiency ladder: 0 未学习 / 1 初识 / 2 熟悉 / 3 掌握 / 4 精通. */
export type WordLevel = 0 | 1 | 2 | 3 | 4;
/** An L3 word promotes to L4 only once this window has elapsed since it reached L3. */
export const FINAL_CHECK_WINDOW_MS = 7 * 86_400_000;
export const LEVEL_NAMES: Record<WordLevel, string> = { 0: "未学习", 1: "初识", 2: "熟悉", 3: "掌握", 4: "精通" };

export type LearningEventInput =
  | { kind: "new"; wordbookId: string; word?: string; wordId?: string; verdict?: "know" | "unknown" }
  | { kind: "flashcard"; wordbookId: string; word?: string; wordId?: string; verdict: "know" | "unknown" }
  | { kind: "dictation"; wordbookId: string; word?: string; wordId?: string; correct: boolean }
  | { kind: "mark"; wordbookId: string; word?: string; wordId?: string; level: WordLevel };
export type LearningEvent =
  | ({ kind: "new"; wordbookId: string; word: string; wordId: string; verdict?: "know" | "unknown"; id: string; occurredAt: string })
  | ({ kind: "flashcard"; wordbookId: string; word: string; wordId: string; verdict: "know" | "unknown"; id: string; occurredAt: string })
  | ({ kind: "dictation"; wordbookId: string; word: string; wordId: string; correct: boolean; id: string; occurredAt: string })
  | ({ kind: "mark"; wordbookId: string; word: string; wordId: string; level: WordLevel; id: string; occurredAt: string });
export type WordLearningStatus = "new" | "learning" | "review" | "mastered";
export interface LevelCounts { l0: number; l1: number; l2: number; l3: number; l4: number; }
export interface WordbookProgress { mastered: number; learning: number; review: number; unstudied: number; percent: number; levels: LevelCounts; }
/**
 * A stored word plus its replayed proficiency. `levelReachedAt` is omitted while still at L0;
 * `lastStudiedAt` (occurredAt of the last event of ANY kind, mark included) drives the spaced-review
 * due rule and is omitted only when the word has never been touched.
 */
export type StudiedWord = WordbookWord & {
  level: WordLevel;
  levelReachedAt?: string;
  lastStudiedAt?: string;
  /** Consecutive "know" verdicts while the word is still L0. */
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
  /** Words currently at L3 whose 7-day window has passed; their next correct dictation reaches L4. */
  finalCheckDue: number;
  updatedAt: string;
}

export interface CatalogQuery { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort; }
export interface CreateMyWordbookInput { title: string; description?: string; words?: StudyWordEntry[]; }
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

/** A registered account. `clientId` is the account's data home (the anonymous id adopted at registration). */
export interface AccountUser { id: string; username: string; passwordHash: string; clientId: string; createdAt: string; }

/** Persistence seam: production SQLite is durable; tests inject the memory store. */
export interface StudyStore {
  // --- Accounts & sessions ---
  /** Case-insensitive username uniqueness; adopts `clientId` as the new account's data home. */
  createUser(username: string, passwordHash: string, clientId: string): Promise<{ kind: "created"; user: AccountUser } | { kind: "taken" } | { kind: "client-taken" }>;
  getUserByUsername(username: string): Promise<AccountUser | null>;
  getUserById(id: string): Promise<AccountUser | null>;
  getUserByClientId(clientId: string): Promise<AccountUser | null>;
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
  listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]>;
  createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard>;
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
  recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null>;
  getDashboard(clientId: string, id: string): Promise<StudyDashboard | null>;
}
