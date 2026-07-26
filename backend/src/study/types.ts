export const WORD_SOURCES = ["backend", "dictionary-api", "local-ielts", "user"] as const;
export type WordSource = (typeof WORD_SOURCES)[number];
export type ZhMeaningSource = "user" | "dictionary";
export type CatalogExam = "IELTS" | "TOEFL" | "GRE" | "高考" | "四六级" | "考研";
export type LearningGoal = "写作" | "阅读" | "听力" | "口语";
export type CatalogSort = "recommended" | "hot" | "newest" | "rating";

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
  /** Points at the owner's private source only; `words` is always a publish-time snapshot. */
  sourceWordbookId?: string;
}
export type CatalogCard = Omit<CatalogWordbook, "words" | "ownerClientId" | "sourceWordbookId"> & {
  wordCount: number; favorited: boolean; added: boolean; uploaded: boolean;
};
export interface MyWordbook {
  id: string; title: string; description: string; sourceCatalogId?: string;
  createdAt: string; updatedAt: string; deletedAt?: string; words: WordbookWord[];
}
export interface MyWordbookCard {
  id: string; title: string; description: string; sourceCatalogId?: string; createdAt: string; updatedAt: string;
  wordCount: number; progress: WordbookProgress;
}

export type LearningEventInput =
  | { kind: "new"; wordbookId: string; word?: string; wordId?: string; verdict?: "know" | "unknown" }
  | { kind: "flashcard"; wordbookId: string; word?: string; wordId?: string; verdict: "know" | "unknown" }
  | { kind: "dictation"; wordbookId: string; word?: string; wordId?: string; correct: boolean };
export type LearningEvent =
  | ({ kind: "new"; wordbookId: string; word: string; wordId: string; verdict?: "know" | "unknown"; id: string; occurredAt: string })
  | ({ kind: "flashcard"; wordbookId: string; word: string; wordId: string; verdict: "know" | "unknown"; id: string; occurredAt: string })
  | ({ kind: "dictation"; wordbookId: string; word: string; wordId: string; correct: boolean; id: string; occurredAt: string });
export type WordLearningStatus = "new" | "learning" | "review" | "mastered";
export interface WordbookProgress { mastered: number; learning: number; review: number; unstudied: number; percent: number; }
export interface LearningQueueItem extends WordbookWord { status: WordLearningStatus; }

export interface StudyDashboard {
  wordbook: MyWordbookCard;
  todayPlan: {
    new: { target: number; completed: number };
    review: { target: number; completed: number };
    dictation: { target: number; completed: number };
  };
  recentActivity: LearningEvent[];
  calendar: Array<{ date: string; count: number; active: boolean }>;
  week: { newCount: number; reviewCount: number; dictationCount: number; total: number };
  streakDays: number;
  updatedAt: string;
}

export interface CatalogQuery { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort; }
export interface CreateMyWordbookInput { title: string; description?: string; words?: StudyWordEntry[]; }
/** Legacy direct upload remains supported; modern uploads reference the private wordbook. */
export interface UploadCatalogWordbookInput extends Partial<CreateMyWordbookInput> {
  sourceWordbookId?: string; exams?: CatalogExam[]; goals?: LearningGoal[];
}
export interface UpdateCatalogWordbookInput {
  sourceWordbookId?: string; title?: string; description?: string; exams?: CatalogExam[]; goals?: LearningGoal[];
}

export type ImportEntryStatus = "processing" | "ready" | "invalid" | "duplicate" | "unmatched" | "conflict";
export type ImportResolution = "keep" | "replace" | "merge" | "discard";
export interface ImportLineInput { line: number; word: string; zhMeaning?: string; }
export interface ImportDraftEntry {
  id: string; line: number; word?: string; zhMeaning?: string;
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
  id: string; status: "processing" | "ready" | "unmatched"; reason?: string; entry?: StudyWordEntry;
}
export interface CommitImportDraftInput { resolutions?: Record<string, ImportResolution>; }
export interface UpdateWordInput {
  word?: string; zhMeaning?: string | null; phonetic?: string; audioUrl?: string | null; meanings?: StudyMeaning[];
}
export type UpdateWordResult = { kind: "updated"; word: WordbookWord } | { kind: "not-found" } | { kind: "duplicate" } | { kind: "lookup-failed" };

/** Persistence seam: production JSON is durable; tests inject the memory store. */
export interface StudyStore {
  listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]>;
  listFavorites(clientId: string): Promise<CatalogCard[]>;
  listUploads(clientId: string): Promise<CatalogCard[]>;
  getCatalog(clientId: string, id: string): Promise<CatalogCard | null>;
  toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean } | null>;
  addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard | null>;
  updateCatalog(clientId: string, id: string, input: UpdateCatalogWordbookInput): Promise<CatalogCard | null>;
  importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]>;
  createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard>;
  getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  deleteMyWordbook(clientId: string, id: string): Promise<boolean>;
  restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null>;
  addWordToMyWordbook(clientId: string, wordbookId: string, entry: StudyWordEntry): Promise<{ word: LearningQueueItem; created: boolean } | null>;
  purgeMyWordbook(clientId: string, id: string): Promise<boolean>;
  deleteCatalogUpload(clientId: string, id: string): Promise<boolean>;
  updateWord(clientId: string, wordbookId: string, wordId: string, input: UpdateWordInput, rematched?: StudyWordEntry, options?: { lookupFailed?: boolean }): Promise<UpdateWordResult>;
  createImportDrafts(clientId: string, input: CreateImportDraftInput): Promise<ImportDraft[]>;
  resolveImportDraftEntries(clientId: string, id: string, entries: ResolvedImportDraftEntry[]): Promise<ImportDraft | null>;
  listImportDrafts(clientId: string): Promise<ImportDraft[]>;
  getImportDraft(clientId: string, id: string): Promise<ImportDraft | null>;
  deleteImportDraft(clientId: string, id: string): Promise<boolean>;
  commitImportDraft(clientId: string, id: string, input: CommitImportDraftInput): Promise<MyWordbookCard | null>;
  recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null>;
  getDashboard(clientId: string, id: string): Promise<StudyDashboard | null>;
}
