import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import { isJsonObject } from "./validation.js";
import type {
  CatalogCard, CatalogQuery, CatalogWordbook, CommitImportDraftInput, CreateImportDraftInput, CreateMyWordbookInput,
  ImportDraft, ImportDraftEntry, LearningEvent, LearningEventInput, LearningQueueItem, MyWordbook, MyWordbookCard,
  ResolvedImportDraftEntry, StudyDashboard, StudyStore, StudyWordEntry, UpdateCatalogWordbookInput, UpdateWordInput,
  UpdateWordResult, UploadCatalogWordbookInput, WordLearningStatus, WordbookProgress, WordbookWord,
} from "./types.js";

interface ClientData { favorites: string[]; wordbooks: MyWordbook[]; events: LearningEvent[]; drafts: ImportDraft[]; }
interface State { version: 3; catalog: CatalogWordbook[]; clients: Record<string, ClientData>; }
const EMPTY = (): State => ({ version: 3, catalog: [], clients: {} });
const RETENTION_MS = 90 * 86_400_000;
const BATCH_SIZE = 500;

function clone<T>(value: T): T { return structuredClone(value); }
function day(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shiftDay(now: Date, offset: number): Date { const result = new Date(now); result.setDate(now.getDate() + offset); return result; }
function toWordbookWords(words: StudyWordEntry[], at: string): WordbookWord[] { return words.map((word) => ({ ...clone(word), id: randomUUID(), addedAt: at })); }
function toCatalogWords(words: WordbookWord[]): StudyWordEntry[] { return words.map(({ id: _id, addedAt: _addedAt, ...word }) => clone(word)); }
function defaultClient(): ClientData { return { favorites: [], wordbooks: [], events: [], drafts: [] }; }
interface WordEventSummary { lastFlashcard?: Extract<LearningEvent, { kind: "flashcard" }>; lastDictation?: Extract<LearningEvent, { kind: "dictation" }>; }
function indexEventsByWord(events: LearningEvent[]): Map<string, WordEventSummary> {
  const index = new Map<string, WordEventSummary>();
  for (const event of events) {
    let summary = index.get(event.wordId);
    if (!summary) { summary = {}; index.set(event.wordId, summary); }
    if (event.kind === "flashcard" && (summary.lastFlashcard?.occurredAt.localeCompare(event.occurredAt) ?? -1) <= 0) summary.lastFlashcard = event;
    else if (event.kind === "dictation" && (summary.lastDictation?.occurredAt.localeCompare(event.occurredAt) ?? -1) <= 0) summary.lastDictation = event;
  }
  return index;
}
function wordStatusFrom(index: Map<string, WordEventSummary>, wordId: string): WordLearningStatus {
  const summary = index.get(wordId);
  if (!summary) return "new";
  if (summary.lastFlashcard?.verdict === "know") return "mastered";
  if (summary.lastFlashcard?.verdict === "unknown" || (summary.lastDictation && !summary.lastDictation.correct)) return "review";
  return "learning";
}
function progress(book: MyWordbook, events: LearningEvent[]): WordbookProgress {
  const index = indexEventsByWord(events);
  const tally: Record<WordLearningStatus, number> = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const word of book.words) tally[wordStatusFrom(index, word.id)] += 1;
  const total = book.words.length;
  return { mastered: tally.mastered, learning: tally.learning, review: tally.review, unstudied: tally.new, percent: total ? Math.round(((tally.mastered + tally.learning * 0.5) / total) * 100) : 0 };
}
function card(book: MyWordbook, events: LearningEvent[]): MyWordbookCard {
  const { words: _words, deletedAt: _deletedAt, ...rest } = book;
  return { ...clone(rest), wordCount: book.words.length, progress: progress(book, events) };
}
function sameMeanings(left: StudyWordEntry["meanings"], right: StudyWordEntry["meanings"]): StudyWordEntry["meanings"] {
  const existing = new Set(left.map((meaning) => `${meaning.pos}\u0000${meaning.definition}`));
  return [...clone(left), ...right.filter((meaning) => !existing.has(`${meaning.pos}\u0000${meaning.definition}`)).map(clone)];
}

/** Fold curly apostrophes in stored word text so it matches today's normalizeWord output. */
function foldApostrophes(word: string): string { return word.replace(/[’ʼ]/g, "'"); }

/** Upgrade the old v2 JSON without losing wordbooks, events, or publishing data. */
function migrate(raw: unknown): State {
  if (!isJsonObject(raw) || !Array.isArray(raw.catalog) || !isJsonObject(raw.clients)) throw new Error("Study data file has an unsupported format");
  if (raw.version !== 2 && raw.version !== 3) throw new Error("Study data file has an unsupported format");
  const state = raw as unknown as State;
  state.version = 3;
  for (const book of state.catalog) {
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
  return state;
}

abstract class BaseStore implements StudyStore {
  private statePromise: Promise<State> | undefined;
  private queue: Promise<void> = Promise.resolve();
  protected constructor(private readonly now: () => Date = () => new Date()) {}
  protected abstract load(): Promise<State>;
  protected abstract save(state: State): Promise<void>;

  async listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const q = query.q?.toLowerCase();
    const books = state.catalog.filter((book) => (!q || `${book.title} ${book.description} ${book.author}`.toLowerCase().includes(q)) && (!query.exam || book.exams.includes(query.exam)) && (!query.goal || book.goals.includes(query.goal)));
    const ordered = [...books].sort((a, b) => query.sort === "hot" ? b.uses - a.uses : query.sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : query.sort === "rating" ? b.rating - a.rating : b.uses - a.uses);
    return ordered.map((book) => this.catalogCard(book, client, clientId));
  }); }
  async listFavorites(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return state.catalog.filter((book) => client.favorites.includes(book.id)).map((book) => this.catalogCard(book, client, clientId)); }); }
  async listUploads(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return state.catalog.filter((book) => book.ownerClientId === clientId).map((book) => this.catalogCard(book, client, clientId)); }); }
  async getCatalog(clientId: string, id: string): Promise<CatalogCard | null> { return await this.read((state) => { const found = state.catalog.find((book) => book.id === id); return found ? this.catalogCard(found, this.clientView(state, clientId), clientId) : null; }); }
  async toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean } | null> { return await this.mutate((state) => {
    if (!state.catalog.some((book) => book.id === id)) return null;
    const client = this.client(state, clientId); const index = client.favorites.indexOf(id);
    if (index >= 0) { client.favorites.splice(index, 1); return { favorited: false }; }
    client.favorites.push(id); return { favorited: true };
  }); }
  async addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.mutate((state) => {
    const source = state.catalog.find((book) => book.id === id); if (!source) return null;
    const client = this.client(state, clientId); const existing = client.wordbooks.find((book) => !book.deletedAt && book.sourceCatalogId === id);
    if (existing) return { wordbook: card(existing, client.events), created: false };
    source.uses += 1; const at = this.now().toISOString();
    const book: MyWordbook = { id: `my-${randomUUID()}`, title: source.title, description: source.description, sourceCatalogId: source.id, createdAt: at, updatedAt: at, words: toWordbookWords(source.words, at) };
    client.wordbooks.push(book); return { wordbook: card(book, client.events), created: true };
  }); }
  async uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const source = input.sourceWordbookId ? client.wordbooks.find((item) => item.id === input.sourceWordbookId && !item.deletedAt) : undefined;
    if (input.sourceWordbookId && !source) return null;
    const now = this.now().toISOString();
    const book: CatalogWordbook = {
      id: `catalog-${randomUUID()}`,
      title: input.title ?? source?.title ?? "",
      description: input.description ?? source?.description ?? "",
      author: "我的词库", exams: input.exams ?? [], goals: input.goals ?? [], rating: 0, uses: 0, createdAt: now,
      shareCode: this.shareCode(state), words: source ? toCatalogWords(source.words) : clone(input.words ?? []), ownerClientId: clientId,
      ...(source ? { sourceWordbookId: source.id } : {}),
    };
    state.catalog.push(book); return this.catalogCard(book, client, clientId);
  }); }
  async updateCatalog(clientId: string, id: string, input: UpdateCatalogWordbookInput): Promise<CatalogCard | null> { return await this.mutate((state) => {
    const catalog = state.catalog.find((item) => item.id === id && item.ownerClientId === clientId); if (!catalog) return null;
    const client = this.client(state, clientId);
    const sourceId = input.sourceWordbookId ?? catalog.sourceWordbookId;
    const source = sourceId ? client.wordbooks.find((item) => item.id === sourceId && !item.deletedAt) : undefined;
    if (sourceId && !source) return null;
    if (source) { catalog.words = toCatalogWords(source.words); catalog.sourceWordbookId = source.id; }
    if (input.title !== undefined) catalog.title = input.title;
    if (input.description !== undefined) catalog.description = input.description;
    if (input.exams !== undefined) catalog.exams = clone(input.exams);
    if (input.goals !== undefined) catalog.goals = clone(input.goals);
    return this.catalogCard(catalog, client, clientId);
  }); }
  async importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.read((state) => state.catalog.find((book) => book.shareCode === shareCode)?.id ?? null).then((id) => id ? this.addCatalogToMine(clientId, id) : null); }
  async listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return client.wordbooks.filter((book) => Boolean(book.deletedAt) === trash).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((book) => card(book, client.events)); }); }
  async createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard> { return await this.mutate((state) => {
    const at = this.now().toISOString(); const client = this.client(state, clientId);
    const book: MyWordbook = { id: `my-${randomUUID()}`, title: input.title, description: input.description ?? "", createdAt: at, updatedAt: at, words: toWordbookWords(input.words ?? [], at) };
    client.wordbooks.push(book); return card(book, client.events);
  }); }
  async getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.read((state) => { const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); return book ? card(book, client.events) : null; }); }
  async deleteMyWordbook(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return false; const at = this.now().toISOString(); book.deletedAt = at; book.updatedAt = at; return true; }); }
  async restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && item.deletedAt); if (!book) return null; book.deletedAt = undefined; book.updatedAt = this.now().toISOString(); return card(book, client.events); }); }
  async listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null;
    const index = indexEventsByWord(client.events.filter((event) => event.wordbookId === id));
    return book.words.map((word) => ({ ...clone(word), status: wordStatusFrom(index, word.id) })).filter((word) => !status || word.status === status);
  }); }
  async updateWord(clientId: string, wordbookId: string, wordId: string, input: UpdateWordInput, rematched?: StudyWordEntry, options?: { lookupFailed?: boolean }): Promise<UpdateWordResult> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === wordbookId && !item.deletedAt); const target = book?.words.find((item) => item.id === wordId);
    if (!book || !target) return { kind: "not-found" };
    // A true rename must not carry the old word's dictionary data forward; when the
    // lookup is transiently down we refuse instead of guessing (non-renames proceed).
    if (input.word && input.word !== target.word && options?.lookupFailed) return { kind: "lookup-failed" };
    if (input.word && input.word !== target.word && book.words.some((item) => item.id !== wordId && item.word === input.word)) return { kind: "duplicate" };
    const oldCustomChinese = target.zhMeaningSource === "user";
    if (input.word && rematched) {
      target.word = rematched.word; target.phonetic = rematched.phonetic; target.audioUrl = rematched.audioUrl; target.meanings = clone(rematched.meanings); target.source = rematched.source;
      if (!oldCustomChinese) {
        if (rematched.zhMeaning) { target.zhMeaning = rematched.zhMeaning; target.zhMeaningSource = rematched.zhMeaningSource; }
        else { delete target.zhMeaning; delete target.zhMeaningSource; }
      }
    } else if (input.word) target.word = input.word;
    if (input.phonetic !== undefined) target.phonetic = input.phonetic;
    if (input.audioUrl !== undefined) { if (input.audioUrl) target.audioUrl = input.audioUrl; else delete target.audioUrl; }
    if (input.meanings !== undefined) target.meanings = clone(input.meanings);
    if (input.zhMeaning !== undefined) {
      if (input.zhMeaning) { target.zhMeaning = input.zhMeaning; target.zhMeaningSource = "user"; }
      else { delete target.zhMeaning; delete target.zhMeaningSource; }
    }
    book.updatedAt = this.now().toISOString(); return { kind: "updated", word: clone(target) };
  }); }
  async createImportDrafts(clientId: string, input: CreateImportDraftInput): Promise<ImportDraft[]> { return await this.mutate((state) => {
    const client = this.client(state, clientId);
    const cutoff = this.now().getTime() - RETENTION_MS;
    client.drafts = client.drafts.filter((draft) => draft.status !== "committed" || Date.parse(draft.committedAt ?? draft.updatedAt) >= cutoff);
    if (input.targetWordbookId && !client.wordbooks.some((book) => book.id === input.targetWordbookId && !book.deletedAt)) return [];
    const seen = new Set<string>();
    const target = input.targetWordbookId ? client.wordbooks.find((book) => book.id === input.targetWordbookId && !book.deletedAt) : undefined;
    const entries = input.lines.map((line): ImportDraftEntry => {
      const normalized = normalizeWord(line.word);
      const entry: ImportDraftEntry = { id: randomUUID(), line: line.line, ...(normalized ? { word: normalized } : {}), ...(line.zhMeaning ? { zhMeaning: line.zhMeaning } : {}), status: "processing" };
      if (!isValidWordQuery(normalized)) { entry.status = "invalid"; entry.reason = "英文单词格式无效"; return entry; }
      if (seen.has(normalized)) { entry.status = "duplicate"; entry.reason = "重复单词"; return entry; }
      seen.add(normalized);
      const existing = target?.words.find((word) => word.word === normalized);
      if (existing) { entry.status = "conflict"; entry.conflictWith = existing.id; entry.reason = "词本中已存在该单词"; }
      return entry;
    });
    const groups: ImportDraftEntry[][] = []; let current: ImportDraftEntry[] = []; let valid = 0;
    for (const entry of entries) {
      const countable = entry.status === "processing" || entry.status === "conflict";
      if (countable && valid >= BATCH_SIZE) { groups.push(current); current = []; valid = 0; }
      current.push(entry); if (countable) valid += 1;
    }
    if (current.length || !groups.length) groups.push(current);
    const at = this.now().toISOString(); const groupId = `group-${randomUUID()}`;
    const drafts = groups.map((batch, index): ImportDraft => ({ id: `draft-${randomUUID()}`, groupId, title: input.title, description: input.description ?? "", ...(input.targetWordbookId ? { targetWordbookId: input.targetWordbookId } : {}), batchIndex: index + 1, totalBatches: groups.length, status: batch.some((entry) => entry.status === "processing" || entry.status === "conflict") ? "processing" : "pending", createdAt: at, updatedAt: at, entries: batch }));
    client.drafts.push(...drafts); return clone(drafts);
  }); }
  async resolveImportDraftEntries(clientId: string, id: string, entries: ResolvedImportDraftEntry[]): Promise<ImportDraft | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const draft = client.drafts.find((item) => item.id === id); if (!draft || draft.status === "committed") return null;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const entry of draft.entries) {
      const resolved = byId.get(entry.id); if (!resolved || (entry.status !== "processing" && entry.status !== "conflict")) continue;
      if (resolved.entry) entry.entry = clone(resolved.entry);
      if (entry.status === "processing") {
        entry.status = resolved.status;
        if (resolved.reason) entry.reason = resolved.reason; else delete entry.reason;
      } else if (resolved.reason && !entry.reason) entry.reason = resolved.reason;
    }
    draft.status = draft.entries.some((entry) => entry.status === "processing" || (entry.status === "conflict" && !entry.entry)) ? "processing" : "pending";
    draft.updatedAt = this.now().toISOString(); return clone(draft);
  }); }
  async listImportDrafts(clientId: string): Promise<ImportDraft[]> { return await this.read((state) => clone([...this.clientView(state, clientId).drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))); }
  async getImportDraft(clientId: string, id: string): Promise<ImportDraft | null> { return await this.read((state) => { const draft = this.clientView(state, clientId).drafts.find((item) => item.id === id); return draft ? clone(draft) : null; }); }
  async deleteImportDraft(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => {
    const drafts = this.client(state, clientId).drafts; const index = drafts.findIndex((item) => item.id === id);
    if (index < 0) return false; drafts.splice(index, 1); return true;
  }); }
  async commitImportDraft(clientId: string, id: string, input: CommitImportDraftInput): Promise<MyWordbookCard | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const draft = client.drafts.find((item) => item.id === id); if (!draft) return null;
    let book = draft.targetWordbookId ? client.wordbooks.find((item) => item.id === draft.targetWordbookId && !item.deletedAt) : undefined;
    const at = this.now().toISOString();
    if (!book) {
      if (draft.targetWordbookId) return null;
      book = { id: `my-${randomUUID()}`, title: draft.title, description: draft.description, createdAt: at, updatedAt: at, words: [] };
      client.wordbooks.push(book);
      for (const sibling of client.drafts) if (sibling.groupId === draft.groupId) sibling.targetWordbookId = book.id;
    }
    if (draft.status !== "committed") {
      for (const item of draft.entries) {
        if (!item.word || !item.entry || (item.status !== "ready" && item.status !== "unmatched" && item.status !== "conflict")) continue;
        const existing = book.words.find((word) => word.word === item.word); const resolution = input.resolutions?.[item.id] ?? "keep";
        item.resolution = resolution;
        if (resolution === "discard") continue;
        if (!existing) { book.words.push({ ...clone(item.entry), id: randomUUID(), addedAt: at }); continue; }
        if (resolution === "replace") { Object.assign(existing, clone(item.entry)); }
        if (resolution === "merge") {
          if (item.entry.zhMeaning && item.entry.zhMeaning !== existing.zhMeaning) {
            existing.zhMeaning = existing.zhMeaning ? `${existing.zhMeaning}；${item.entry.zhMeaning}` : item.entry.zhMeaning;
            existing.zhMeaningSource = item.entry.zhMeaningSource ?? existing.zhMeaningSource;
          }
          existing.meanings = sameMeanings(existing.meanings, item.entry.meanings);
          if (!existing.phonetic) existing.phonetic = item.entry.phonetic;
          if (!existing.audioUrl) existing.audioUrl = item.entry.audioUrl;
        }
      }
      book.updatedAt = at; draft.status = "committed"; draft.committedAt = at; draft.updatedAt = at;
    }
    return card(book, client.events);
  }); }
  async recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === input.wordbookId && !item.deletedAt);
    const target = input.wordId ? book?.words.find((word) => word.id === input.wordId) : book?.words.find((word) => word.word === input.word);
    if (!book || !target) return null;
    const now = this.now(); client.events = client.events.filter((event) => Date.parse(event.occurredAt) >= now.getTime() - RETENTION_MS);
    const common = { wordbookId: book.id, word: target.word, wordId: target.id, id: randomUUID(), occurredAt: now.toISOString() };
    const event: LearningEvent = input.kind === "new" ? { ...common, kind: "new" } : input.kind === "flashcard" ? { ...common, kind: "flashcard", verdict: input.verdict } : { ...common, kind: "dictation", correct: input.correct };
    client.events.push(event); book.updatedAt = event.occurredAt; return event;
  }); }
  async getDashboard(clientId: string, id: string): Promise<StudyDashboard | null> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null;
    const now = this.now(); const today = day(now); const events = client.events.filter((event) => event.wordbookId === id); const todayEvents = events.filter((event) => day(new Date(event.occurredAt)) === today);
    const count = (items: LearningEvent[], kind: LearningEvent["kind"]) => items.filter((event) => event.kind === kind).length;
    const completedNew = count(todayEvents, "new"); const completedReview = count(todayEvents, "flashcard"); const completedDictation = count(todayEvents, "dictation"); const bookProgress = progress(book, events);
    const perDay = new Map<string, number>(); for (const event of events) { const key = day(new Date(event.occurredAt)); perDay.set(key, (perDay.get(key) ?? 0) + 1); }
    const calendar = Array.from({ length: 7 }, (_, index) => { const date = day(shiftDay(now, index - 6)); const amount = perDay.get(date) ?? 0; return { date, count: amount, active: amount > 0 }; });
    let streak = 0; for (let offset = 0; offset < 365; offset += 1) { if (!perDay.get(day(shiftDay(now, -offset)))) break; streak += 1; }
    // Same 7 calendar days as the calendar block so both widgets always agree.
    const weekDays = new Set(calendar.map((item) => item.date));
    const weekEvents = events.filter((event) => weekDays.has(day(new Date(event.occurredAt))));
    const weekNew = count(weekEvents, "new"); const weekReview = count(weekEvents, "flashcard"); const weekDictation = count(weekEvents, "dictation");
    return { wordbook: card(book, events), todayPlan: { new: { target: Math.min(20, Math.max(completedNew, bookProgress.unstudied)), completed: completedNew }, review: { target: Math.min(30, Math.max(completedReview, bookProgress.review + bookProgress.learning)), completed: completedReview }, dictation: { target: Math.min(15, book.words.length), completed: completedDictation } }, recentActivity: clone([...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5)), calendar, week: { newCount: weekNew, reviewCount: weekReview, dictationCount: weekDictation, total: weekNew + weekReview + weekDictation }, streakDays: streak, updatedAt: book.updatedAt };
  }); }
  private catalogCard(book: CatalogWordbook, client?: ClientData, clientId?: string): CatalogCard {
    const { words: _words, ownerClientId: _owner, sourceWordbookId: _source, ...rest } = book;
    return { ...clone(rest), wordCount: book.words.length, favorited: client?.favorites.includes(book.id) ?? false, added: client?.wordbooks.some((item) => !item.deletedAt && item.sourceCatalogId === book.id) ?? false, uploaded: book.ownerClientId === clientId };
  }
  private client(state: State, id: string): ClientData { return state.clients[id] ??= defaultClient(); }
  /** Read-only view: never inserts a client record, so GETs cannot grow the persisted state. */
  private clientView(state: State, id: string): ClientData { return state.clients[id] ?? defaultClient(); }
  private shareCode(state: State): string { let code = ""; do { code = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(); } while (state.catalog.some((book) => book.shareCode === code)); return code; }
  private async read<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => operation(await this.state())); this.queue = task.then(() => undefined, () => undefined); return await task; }
  private async mutate<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => {
    const draft = clone(await this.state());
    const value = operation(draft);
    await this.save(draft);
    this.statePromise = Promise.resolve(draft);
    return value;
  }); this.queue = task.then(() => undefined, () => undefined); return await task; }
  private async state(): Promise<State> {
    if (!this.statePromise) {
      const loading = this.load();
      loading.catch(() => { if (this.statePromise === loading) this.statePromise = undefined; });
      this.statePromise = loading;
    }
    return await this.statePromise;
  }
}
export class InMemoryStudyStore extends BaseStore { constructor(options: { now?: () => Date } = {}) { super(options.now); } protected async load(): Promise<State> { return EMPTY(); } protected async save(_state: State): Promise<void> {} }
export class JsonFileStudyStore extends BaseStore {
  private readonly filePath: string;
  constructor(filePath: string, options: { now?: () => Date } = {}) { super(options.now); this.filePath = resolve(filePath); }
  protected async load(): Promise<State> { try { return migrate(JSON.parse(await readFile(this.filePath, "utf8")) as unknown); } catch (error) { if (isJsonObject(error) && error.code === "ENOENT") return EMPTY(); throw error; } }
  protected async save(state: State): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temp, this.filePath); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
}
