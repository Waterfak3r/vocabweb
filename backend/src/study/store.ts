import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isJsonObject, parseLearningEvent, parseStudyWordEntry } from "./validation.js";
import type {
  CatalogCard, CatalogQuery, CatalogWordbook, CreateMyWordbookInput, LearningEvent, LearningEventInput,
  LearningQueueItem, MyWordbook, MyWordbookCard, StudyDashboard, StudyStore, StudyWordEntry,
  UploadCatalogWordbookInput, WordLearningStatus, WordbookProgress, WordbookWord,
} from "./types.js";

interface ClientData { favorites: string[]; wordbooks: MyWordbook[]; events: LearningEvent[]; }
interface State { version: 2; catalog: CatalogWordbook[]; clients: Record<string, ClientData>; }
const EMPTY = (): State => ({ version: 2, catalog: seedCatalog(), clients: {} });
const RETENTION_MS = 90 * 86_400_000;

const SAMPLE_WORDS: StudyWordEntry[] = [
  { word: "resilient", phonetic: "/rɪˈzɪliənt/", meanings: [{ pos: "adjective", definition: "Able to recover quickly from difficult conditions." }], source: "local-ielts" },
  { word: "empirical", phonetic: "/ɪmˈpɪrɪkəl/", meanings: [{ pos: "adjective", definition: "Based on observation or experience." }], source: "local-ielts" },
  { word: "inevitable", phonetic: "/ɪnˈevɪtəbəl/", meanings: [{ pos: "adjective", definition: "Certain to happen; unavoidable." }], source: "local-ielts" },
  { word: "prioritize", phonetic: "/praɪˈɒrətaɪz/", meanings: [{ pos: "verb", definition: "Decide which tasks are most important." }], source: "local-ielts" },
  { word: "contribute", phonetic: "/kənˈtrɪbjuːt/", meanings: [{ pos: "verb", definition: "Give or supply in order to help achieve something." }], source: "local-ielts" },
];
function seedCatalog(): CatalogWordbook[] {
  const made = "2026-01-01T00:00:00.000Z";
  return [
    { id: "catalog-ielts-core", title: "IELTS 核心词汇", description: "雅思高频词，覆盖听说读写常见场景。", author: "Luna", exams: ["IELTS"], goals: ["写作", "阅读", "听力", "口语"], rating: 4.8, uses: 23_000, createdAt: made, shareCode: "IELTS01", words: SAMPLE_WORDS },
    { id: "catalog-gaokao", title: "高考3500", description: "高考英语核心词汇，适合基础巩固。", author: "字海无涯", exams: ["高考"], goals: ["阅读", "写作"], rating: 4.7, uses: 31_000, createdAt: "2026-02-01T00:00:00.000Z", shareCode: "GAOKAO1", words: SAMPLE_WORDS.slice(1) },
    { id: "catalog-cet", title: "四六级高频词", description: "精选四、六级高频词与考场搭配。", author: "CETer", exams: ["四六级"], goals: ["阅读", "听力"], rating: 4.6, uses: 18_000, createdAt: "2026-03-01T00:00:00.000Z", shareCode: "CET0001", words: SAMPLE_WORDS.slice(0, 4) },
    { id: "catalog-reading-hard", title: "阅读难词合集", description: "精选阅读难词与学术语境表达。", author: "ReadMaster", exams: ["IELTS", "考研"], goals: ["阅读"], rating: 4.7, uses: 90_000, createdAt: "2026-03-15T00:00:00.000Z", shareCode: "READ0001", words: SAMPLE_WORDS.slice(1, 5) },
    { id: "catalog-writing", title: "考研英语写作", description: "写作高分词汇与搭配。", author: "WritingLab", exams: ["考研"], goals: ["写作"], rating: 4.9, uses: 12_000, createdAt: "2026-04-01T00:00:00.000Z", shareCode: "WRITE01", words: SAMPLE_WORDS.slice(0, 3) },
    { id: "catalog-ielts-speaking", title: "雅思口语话题词", description: "按话题分类的雅思口语词汇，提升表达积累。", author: "SpeakUp", exams: ["IELTS"], goals: ["口语"], rating: 4.8, uses: 16_000, createdAt: "2026-04-15T00:00:00.000Z", shareCode: "SPEAK001", words: SAMPLE_WORDS.slice(0, 4) },
    { id: "catalog-academic-reading", title: "学术阅读词汇", description: "论文与学术阅读常见高阶词汇合集。", author: "AcademicLab", exams: ["IELTS", "TOEFL", "GRE"], goals: ["阅读", "写作"], rating: 4.7, uses: 9_000, createdAt: "2026-05-01T00:00:00.000Z", shareCode: "ACADEMIC", words: SAMPLE_WORDS.slice(1) },
  ];
}
function mergeMissingSeedCatalog(state: State): boolean {
  const existingIds = new Set(state.catalog.map((book) => book.id));
  const missing = seedCatalog().filter((book) => !existingIds.has(book.id));
  if (missing.length === 0) return false;
  state.catalog.push(...clone(missing));
  return true;
}
function clone<T>(value: T): T { return structuredClone(value); }
function day(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shiftDay(now: Date, offset: number): Date { const result = new Date(now); result.setDate(now.getDate() + offset); return result; }
function toWordbookWords(words: StudyWordEntry[], at: string): WordbookWord[] { return words.map((word) => ({ ...clone(word), id: word.word, addedAt: at })); }
function defaultClient(at: string): ClientData {
  const createBook = (id: string, title: string, description: string, words: StudyWordEntry[]): MyWordbook => ({ id, title, description, createdAt: at, updatedAt: at, words: toWordbookWords(words, at) });
  return {
    favorites: ["catalog-ielts-core", "catalog-gaokao"],
    events: [],
    wordbooks: [
      createBook("my-writing-task-2", "IELTS Writing Task 2", "雅思大作文常用学术词、论证词与搭配。", SAMPLE_WORDS),
      createBook("my-reading-vocabulary", "阅读生词本", "阅读中积累的重点词汇。", SAMPLE_WORDS.slice(0, 3)),
      createBook("my-listening-errors", "听力错词本", "听力练习中的易错词。", SAMPLE_WORDS.slice(1, 4)),
      createBook("my-gaokao-hard", "高频难词本", "高频且容易混淆的词汇。", SAMPLE_WORDS.slice(2)),
      createBook("my-postgraduate-core", "考研核心词汇", "考研阅读与写作核心词。", SAMPLE_WORDS.slice(0, 4)),
      createBook("my-daily-fruits", "日常积累", "日常查询和收藏的英语词。", SAMPLE_WORDS.slice(3)),
    ],
  };
}
function wordStatus(word: string, events: LearningEvent[]): WordLearningStatus {
  const own = events.filter((event) => event.word === word).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const lastFlashcard = [...own].reverse().find((event) => event.kind === "flashcard");
  const lastDictation = [...own].reverse().find((event) => event.kind === "dictation");
  if (lastFlashcard?.kind === "flashcard" && lastFlashcard.verdict === "know") return "mastered";
  if ((lastFlashcard?.kind === "flashcard" && lastFlashcard.verdict === "unknown") || (lastDictation?.kind === "dictation" && !lastDictation.correct)) return "review";
  return own.length ? "learning" : "new";
}
function progress(book: MyWordbook, events: LearningEvent[]): WordbookProgress {
  const tally: Record<WordLearningStatus, number> = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const word of book.words) tally[wordStatus(word.word, events)] += 1;
  const total = book.words.length;
  return { mastered: tally.mastered, learning: tally.learning, review: tally.review, unstudied: tally.new, percent: total ? Math.round(((tally.mastered + tally.learning * 0.5) / total) * 100) : 0 };
}
function card(book: MyWordbook, events: LearningEvent[]): MyWordbookCard { const { words: _words, deletedAt: _deletedAt, ...rest } = book; return { ...clone(rest), wordCount: book.words.length, progress: progress(book, events) }; }

abstract class BaseStore implements StudyStore {
  private statePromise: Promise<State> | undefined; private queue: Promise<void> = Promise.resolve();
  protected constructor(private readonly now: () => Date = () => new Date()) {}
  protected abstract load(): Promise<State>; protected abstract save(state: State): Promise<void>;
  async listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const q = query.q?.toLowerCase();
    const books = state.catalog.filter((book) => (!q || `${book.title} ${book.description} ${book.author}`.toLowerCase().includes(q)) && (!query.exam || book.exams.includes(query.exam)) && (!query.goal || book.goals.includes(query.goal)));
    const ordered = [...books].sort((a, b) => query.sort === "hot" ? b.uses - a.uses : query.sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : query.sort === "rating" ? b.rating - a.rating : b.uses - a.uses);
    return ordered.map((book) => this.catalogCard(book, client, clientId));
  }); }
  async listFavorites(clientId: string): Promise<CatalogCard[]> { return await this.mutate((state) => { const client = this.client(state, clientId); return state.catalog.filter((book) => client.favorites.includes(book.id)).map((book) => this.catalogCard(book, client, clientId)); }); }
  async listUploads(clientId: string): Promise<CatalogCard[]> { return await this.mutate((state) => { const client = this.client(state, clientId); return state.catalog.filter((book) => book.ownerClientId === clientId).map((book) => this.catalogCard(book, client, clientId)); }); }
  async getCatalog(clientId: string, id: string): Promise<CatalogCard | null> { return await this.mutate((state) => { const found = state.catalog.find((book) => book.id === id); return found ? this.catalogCard(found, this.client(state, clientId), clientId) : null; }); }
  async toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean } | null> { return await this.mutate((state) => {
    if (!state.catalog.some((book) => book.id === id)) return null; const client = this.client(state, clientId); const index = client.favorites.indexOf(id);
    if (index >= 0) { client.favorites.splice(index, 1); return { favorited: false }; } client.favorites.push(id); return { favorited: true };
  }); }
  async addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.mutate((state) => {
    const source = state.catalog.find((book) => book.id === id); if (!source) return null; const client = this.client(state, clientId);
    const existing = client.wordbooks.find((book) => !book.deletedAt && book.sourceCatalogId === id); if (existing) return { wordbook: card(existing, client.events), created: false };
    source.uses += 1; const at = this.now().toISOString(); const book: MyWordbook = { id: `my-${randomUUID()}`, title: source.title, description: source.description, sourceCatalogId: source.id, createdAt: at, updatedAt: at, words: toWordbookWords(source.words, at) }; client.wordbooks.push(book); return { wordbook: card(book, client.events), created: true };
  }); }
  async uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard> { return await this.mutate((state) => {
    const now = this.now().toISOString(); const book: CatalogWordbook = { id: `catalog-${randomUUID()}`, title: input.title, description: input.description ?? "", author: "我的词库", exams: input.exams ?? [], goals: input.goals ?? [], rating: 0, uses: 0, createdAt: now, shareCode: this.shareCode(state), words: clone(input.words ?? []), ownerClientId: clientId }; state.catalog.push(book); return this.catalogCard(book, this.client(state, clientId), clientId);
  }); }
  async importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.read((state) => state.catalog.find((book) => book.shareCode === shareCode)?.id ?? null).then((id) => id ? this.addCatalogToMine(clientId, id) : null); }
  async listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]> { return await this.mutate((state) => { const client = this.client(state, clientId); return client.wordbooks.filter((book) => Boolean(book.deletedAt) === trash).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((book) => card(book, client.events)); }); }
  async createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard> { return await this.mutate((state) => { const at = this.now().toISOString(); const client = this.client(state, clientId); const book: MyWordbook = { id: `my-${randomUUID()}`, title: input.title, description: input.description ?? "", createdAt: at, updatedAt: at, words: toWordbookWords(input.words ?? [], at) }; client.wordbooks.push(book); return card(book, client.events); }); }
  async getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); return book ? card(book, client.events) : null; }); }
  async deleteMyWordbook(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return false; const at = this.now().toISOString(); book.deletedAt = at; book.updatedAt = at; return true; }); }
  async restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && item.deletedAt); if (!book) return null; book.deletedAt = undefined; book.updatedAt = this.now().toISOString(); return card(book, client.events); }); }
  async listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null; return book.words.map((word) => ({ ...clone(word), status: wordStatus(word.word, client.events.filter((event) => event.wordbookId === id)) })).filter((word) => !status || word.status === status); }); }
  async recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === input.wordbookId && !item.deletedAt); if (!book || !book.words.some((word) => word.word === input.word)) return null; const now = this.now(); client.events = client.events.filter((event) => Date.parse(event.occurredAt) >= now.getTime() - RETENTION_MS); const event: LearningEvent = { ...clone(input), id: randomUUID(), occurredAt: now.toISOString() }; client.events.push(event); book.updatedAt = event.occurredAt; return event; }); }
  async getDashboard(clientId: string, id: string): Promise<StudyDashboard | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null; const now = this.now(); const today = day(now); const events = client.events.filter((event) => event.wordbookId === id); const todayEvents = events.filter((event) => day(new Date(event.occurredAt)) === today); const count = (items: LearningEvent[], kind: LearningEvent["kind"]) => items.filter((event) => event.kind === kind).length; const calendar = Array.from({ length: 7 }, (_, index) => { const date = day(shiftDay(now, index - 6)); const amount = events.filter((event) => day(new Date(event.occurredAt)) === date).length; return { date, count: amount, active: amount > 0 }; }); let streak = 0; for (let offset = 0; offset < 365; offset += 1) { if (!calendar.find((item) => item.date === day(shiftDay(now, -offset)))?.active && !events.some((event) => day(new Date(event.occurredAt)) === day(shiftDay(now, -offset)))) break; streak += 1; } const weekNew = count(events, "new"); const weekReview = count(events, "flashcard"); const weekDictation = count(events, "dictation"); return { wordbook: card(book, events), todayPlan: { new: { target: 20, completed: count(todayEvents, "new") }, review: { target: 30, completed: count(todayEvents, "flashcard") }, dictation: { target: 15, completed: count(todayEvents, "dictation") } }, recentActivity: clone([...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5)), calendar, week: { newCount: weekNew, reviewCount: weekReview, dictationCount: weekDictation, total: weekNew + weekReview + weekDictation }, streakDays: streak, updatedAt: book.updatedAt }; }); }
  private catalogCard(book: CatalogWordbook, client?: ClientData, clientId?: string): CatalogCard {
    const { words: _words, ownerClientId, ...rest } = book;
    return {
      ...clone(rest),
      wordCount: book.words.length,
      favorited: client?.favorites.includes(book.id) ?? false,
      added: client?.wordbooks.some((item) => !item.deletedAt && item.sourceCatalogId === book.id) ?? false,
      uploaded: ownerClientId === clientId,
    };
  }
  private client(state: State, id: string): ClientData { return state.clients[id] ??= defaultClient(this.now().toISOString()); }
  private shareCode(state: State): string { let code = ""; do { code = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(); } while (state.catalog.some((book) => book.shareCode === code)); return code; }
  private async read<T>(operation: (state: State) => T): Promise<T> { await this.queue; return operation(await this.state()); }
  private async mutate<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => { const state = await this.state(); const value = operation(state); await this.save(state); return value; }); this.queue = task.then(() => undefined, () => undefined); return await task; }
  private async state(): Promise<State> { this.statePromise ??= this.load(); return await this.statePromise; }
}
export class InMemoryStudyStore extends BaseStore { constructor(options: { now?: () => Date } = {}) { super(options.now); } protected async load(): Promise<State> { return EMPTY(); } protected async save(_state: State): Promise<void> {} }
export class JsonFileStudyStore extends BaseStore {
  private readonly filePath: string;
  constructor(filePath: string, options: { now?: () => Date } = {}) { super(options.now); this.filePath = resolve(filePath); }
  protected async load(): Promise<State> { try { const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown; if (!isJsonObject(raw) || raw.version !== 2 || !Array.isArray(raw.catalog) || !isJsonObject(raw.clients)) throw new Error("Study data file has an unsupported format"); const state = raw as unknown as State; if (mergeMissingSeedCatalog(state)) await this.save(state); return state; } catch (error) { if (isJsonObject(error) && error.code === "ENOENT") return EMPTY(); throw error; } }
  protected async save(state: State): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temp, this.filePath); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
}
