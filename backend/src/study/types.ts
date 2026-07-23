export const WORD_SOURCES = ["backend", "dictionary-api", "local-ielts", "user"] as const;
export type WordSource = (typeof WORD_SOURCES)[number];
export type CatalogExam = "IELTS" | "TOEFL" | "GRE" | "高考" | "四六级" | "考研";
export type LearningGoal = "写作" | "阅读" | "听力" | "口语";
export type CatalogSort = "recommended" | "hot" | "newest" | "rating";

export interface StudyMeaning { pos: string; definition: string; example?: string; }
export interface StudyWordEntry {
  word: string; phonetic: string; audioUrl?: string; meanings: StudyMeaning[]; source: WordSource;
}
export interface WordbookWord extends StudyWordEntry { id: string; addedAt: string; }

export interface CatalogWordbook {
  id: string; title: string; description: string; author: string;
  exams: CatalogExam[]; goals: LearningGoal[]; rating: number; uses: number;
  createdAt: string; shareCode: string; words: StudyWordEntry[]; ownerClientId?: string;
}
export type CatalogCard = Omit<CatalogWordbook, "words" | "ownerClientId"> & { wordCount: number; favorited: boolean; added: boolean };
export interface MyWordbook {
  id: string; title: string; description: string; sourceCatalogId?: string;
  createdAt: string; updatedAt: string; deletedAt?: string; words: WordbookWord[];
}
export interface MyWordbookCard {
  id: string; title: string; description: string; sourceCatalogId?: string; createdAt: string; updatedAt: string;
  wordCount: number; progress: WordbookProgress;
}

export type LearningEventInput =
  | { kind: "new"; wordbookId: string; word: string }
  | { kind: "flashcard"; wordbookId: string; word: string; verdict: "know" | "unknown" }
  | { kind: "dictation"; wordbookId: string; word: string; correct: boolean };
export type LearningEvent = LearningEventInput & { id: string; occurredAt: string };
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
export interface UploadCatalogWordbookInput extends CreateMyWordbookInput { exams?: CatalogExam[]; goals?: LearningGoal[]; }

/** Persistence seam: production JSON is durable; tests inject the memory store. */
export interface StudyStore {
  listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]>;
  getCatalog(clientId: string, id: string): Promise<CatalogCard | null>;
  toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean } | null>;
  addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard>;
  importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null>;
  listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]>;
  createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard>;
  getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  deleteMyWordbook(clientId: string, id: string): Promise<boolean>;
  restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null>;
  listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null>;
  recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null>;
  getDashboard(clientId: string, id: string): Promise<StudyDashboard | null>;
}
