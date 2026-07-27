import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import { isJsonObject } from "./validation.js";
import { FINAL_CHECK_WINDOW_MS } from "./types.js";
import {
  BATCH_SIZE, RETENTION_MS, card, catalogCard, clone, day, dayDiff, defaultClient, EMPTY, ladderEventLevels, ladderOf,
  ladderStates, migrate, progress, queueItem, reviewDue, sameMeanings, shiftDay, studiedWord, toCatalogWords,
  toWordbookWords, visibleTo,
} from "./ladder.js";
import type { ClientData, State } from "./ladder.js";
import type {
  AccountUser, CatalogCard, CatalogQuery, CatalogWordbook, CommitImportDraftInput, CreateImportDraftInput, CreateMyWordbookInput,
  ImportDraft, ImportDraftEntry, LearningEvent, LearningEventInput, LearningQueueItem, MyWordbook, MyWordbookCard,
  ResolvedImportDraftEntry, StudyDashboard, StudyStore, StudyWordEntry, UpdateCatalogWordbookInput, UpdateWordInput,
  UpdateWordResult, UploadCatalogWordbookInput, WordbookWord, WordLearningStatus, WordLevel,
} from "./types.js";

export { EMPTY, migrate };
export type { ClientData, State };

export abstract class BaseStore implements StudyStore {
  private statePromise: Promise<State> | undefined;
  private queue: Promise<void> = Promise.resolve();
  protected constructor(protected readonly now: () => Date = () => new Date()) {}
  protected abstract load(): Promise<State>;
  /** Persist one state transition; record-oriented stores can diff against `previous`. */
  protected abstract save(state: State, previous?: State): Promise<void>;

  // --- Accounts & sessions ---
  async createUser(username: string, passwordHash: string, clientId: string): Promise<{ kind: "created"; user: AccountUser } | { kind: "taken" } | { kind: "client-taken" }> { return await this.mutate((state) => {
    const lower = username.toLowerCase();
    if (state.users.some((user) => user.username.toLowerCase() === lower)) return { kind: "taken" as const };
    if (state.users.some((user) => user.clientId === clientId)) return { kind: "client-taken" as const };
    const user: AccountUser = { id: `user-${randomUUID()}`, username, passwordHash, clientId, createdAt: this.now().toISOString() };
    state.users.push(user);
    // Registering adopts the requesting anonymous client as the account's data home.
    this.client(state, clientId);
    return { kind: "created" as const, user: clone(user) };
  }); }
  async getUserByUsername(username: string): Promise<AccountUser | null> { return await this.read((state) => { const lower = username.toLowerCase(); const user = state.users.find((item) => item.username.toLowerCase() === lower); return user ? clone(user) : null; }); }
  async getUserById(id: string): Promise<AccountUser | null> { return await this.read((state) => { const user = state.users.find((item) => item.id === id); return user ? clone(user) : null; }); }
  async getUserByClientId(clientId: string): Promise<AccountUser | null> { return await this.read((state) => { const user = state.users.find((item) => item.clientId === clientId); return user ? clone(user) : null; }); }
  async createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> { await this.mutate((state) => {
    const now = this.now();
    state.sessions = state.sessions.filter((session) => session.tokenHash !== tokenHash && Date.parse(session.expiresAt) > now.getTime());
    state.sessions.push({ tokenHash, userId, expiresAt, createdAt: now.toISOString() });
  }); }
  async getSession(tokenHash: string, now: Date): Promise<{ user: AccountUser; expiresAt: string } | null> {
    // A live session is a pure read; only an expired one triggers a write (its deletion).
    const found = await this.read((state) => {
      const session = state.sessions.find((item) => item.tokenHash === tokenHash);
      if (!session) return { value: null, expired: false };
      if (Date.parse(session.expiresAt) <= now.getTime()) return { value: null, expired: true };
      const user = state.users.find((item) => item.id === session.userId);
      return { value: user ? { user: clone(user), expiresAt: session.expiresAt } : null, expired: false };
    });
    if (found.expired) await this.deleteSession(tokenHash);
    return found.value;
  }
  async deleteSession(tokenHash: string): Promise<void> { await this.mutate((state) => { state.sessions = state.sessions.filter((session) => session.tokenHash !== tokenHash); }); }
  async mergeClients(fromClientId: string, intoClientId: string): Promise<void> { await this.mutate((state) => {
    if (fromClientId === intoClientId) return;
    const source = state.clients[fromClientId];
    if (!source || (!source.wordbooks.length && !source.events.length && !source.drafts.length && !source.favorites.length)) return;
    const target = this.client(state, intoClientId);
    const incoming = clone(source);
    // A migrated/crafted data file can contain ids that already exist in the account
    // home. Remap only colliding ids and rewrite every dependent reference.
    const usedBookIds = new Set(target.wordbooks.map((book) => book.id));
    const usedWordIds = new Set(target.wordbooks.flatMap((book) => book.words.map((word) => word.id)));
    const usedEventIds = new Set(target.events.map((event) => event.id));
    const usedDraftIds = new Set(target.drafts.map((draft) => draft.id));
    const usedDraftEntryIds = new Set(target.drafts.flatMap((draft) => draft.entries.map((entry) => entry.id)));
    const bookIds = new Map<string, string>();
    const wordIds = new Map<string, string>();
    for (const book of incoming.wordbooks) {
      const oldBookId = book.id;
      if (usedBookIds.has(book.id)) book.id = `my-${randomUUID()}`;
      usedBookIds.add(book.id);
      bookIds.set(oldBookId, book.id);
      for (const word of book.words) {
        const oldWordId = word.id;
        if (usedWordIds.has(word.id)) word.id = randomUUID();
        usedWordIds.add(word.id);
        wordIds.set(`${oldBookId}:${oldWordId}`, word.id);
      }
    }
    for (const event of incoming.events) {
      const oldBookId = event.wordbookId;
      event.wordbookId = bookIds.get(oldBookId) ?? oldBookId;
      event.wordId = wordIds.get(`${oldBookId}:${event.wordId}`) ?? event.wordId;
      if (usedEventIds.has(event.id)) event.id = randomUUID();
      usedEventIds.add(event.id);
    }
    for (const draft of incoming.drafts) {
      if (usedDraftIds.has(draft.id)) draft.id = `draft-${randomUUID()}`;
      usedDraftIds.add(draft.id);
      if (draft.targetWordbookId) draft.targetWordbookId = bookIds.get(draft.targetWordbookId) ?? draft.targetWordbookId;
      for (const entry of draft.entries) {
        if (usedDraftEntryIds.has(entry.id)) entry.id = randomUUID();
        usedDraftEntryIds.add(entry.id);
      }
    }
    target.wordbooks.push(...incoming.wordbooks);
    target.events.push(...incoming.events);
    target.drafts.push(...incoming.drafts);
    target.favorites = [...new Set([...target.favorites, ...source.favorites])];
    // Owned catalog listings follow the merged client home; author attribution is untouched.
    for (const book of state.catalog) if (book.ownerClientId === fromClientId) {
      book.ownerClientId = intoClientId;
      if (book.sourceWordbookId) book.sourceWordbookId = bookIds.get(book.sourceWordbookId) ?? book.sourceWordbookId;
    }
    // The now-empty source home is retired so a repeat merge is a no-op.
    delete state.clients[fromClientId];
  }); }

  // --- Catalog & marketplace ---
  async listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const q = query.q?.toLowerCase();
    // The public marketplace lists public entries only; unlisted/private stay off the shelves.
    const books = state.catalog.filter((book) => book.visibility === "public" && (!q || `${book.title} ${book.description} ${book.author}`.toLowerCase().includes(q)) && (!query.exam || book.exams.includes(query.exam)) && (!query.goal || book.goals.includes(query.goal)));
    const ordered = [...books].sort((a, b) => query.sort === "hot" ? b.uses - a.uses : query.sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : query.sort === "rating" ? b.rating - a.rating : b.uses - a.uses);
    return ordered.map((book) => catalogCard(book, client, clientId));
  }); }
  async listFavorites(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => {
    const client = this.clientView(state, clientId);
    // Keep an already-favorited unlisted entry manageable, while private remains owner-only.
    return state.catalog.filter((book) => client.favorites.includes(book.id) && (book.visibility !== "private" || book.ownerClientId === clientId)).map((book) => catalogCard(book, client, clientId));
  }); }
  async listUploads(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return state.catalog.filter((book) => book.ownerClientId === clientId).map((book) => catalogCard(book, client, clientId)); }); }
  async getCatalog(clientId: string, id: string): Promise<CatalogCard | null> { return await this.read((state) => { const found = state.catalog.find((book) => book.id === id); return found && visibleTo(found, clientId) ? catalogCard(found, this.clientView(state, clientId), clientId) : null; }); }
  async toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean } | null> { return await this.mutate((state) => {
    const book = state.catalog.find((item) => item.id === id);
    const client = this.client(state, clientId); const index = client.favorites.indexOf(id);
    if (!book || (index < 0 && !visibleTo(book, clientId)) || (index >= 0 && book.visibility === "private" && book.ownerClientId !== clientId)) return null;
    if (index >= 0) { client.favorites.splice(index, 1); return { favorited: false }; }
    client.favorites.push(id); return { favorited: true };
  }); }
  async addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.mutate((state) => {
    const source = state.catalog.find((book) => book.id === id); if (!source || !visibleTo(source, clientId)) return null;
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
      // An authenticated upload is attributed to its username; anonymous uploads read "匿名".
      author: input.author?.username ?? "匿名", exams: input.exams ?? [], goals: input.goals ?? [], rating: 0, uses: 0, createdAt: now,
      visibility: input.visibility ?? "public",
      shareCode: this.shareCode(state), words: source ? toCatalogWords(source.words) : clone(input.words ?? []), ownerClientId: clientId,
      ...(input.author ? { authorUserId: input.author.userId } : {}),
      ...(source ? { sourceWordbookId: source.id } : {}),
    };
    state.catalog.push(book); return catalogCard(book, client, clientId);
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
    if (input.visibility !== undefined) catalog.visibility = input.visibility;
    // Going public (or any authenticated edit) re-attributes the entry to the acting account.
    if (input.author !== undefined) { catalog.author = input.author.username; catalog.authorUserId = input.author.userId; }
    return catalogCard(catalog, client, clientId);
  }); }
  async importShareCode(clientId: string, shareCode: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> {
    // This is intentionally one mutation instead of delegating to direct-id add:
    // unlisted is valid here, and the lookup/use increment/copy must share one state snapshot.
    return await this.mutate((state) => {
      const source = state.catalog.find((book) => book.shareCode === shareCode && book.visibility !== "private");
      if (!source) return null;
      const client = this.client(state, clientId);
      const existing = client.wordbooks.find((book) => !book.deletedAt && book.sourceCatalogId === source.id);
      if (existing) return { wordbook: card(existing, client.events), created: false };
      source.uses += 1;
      const at = this.now().toISOString();
      const book: MyWordbook = {
        id: `my-${randomUUID()}`, title: source.title, description: source.description,
        sourceCatalogId: source.id, createdAt: at, updatedAt: at, words: toWordbookWords(source.words, at),
      };
      client.wordbooks.push(book);
      return { wordbook: card(book, client.events), created: true };
    });
  }

  // --- Private collection ---
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
    const states = ladderStates(client.events.filter((event) => event.wordbookId === id));
    return book.words.map((word) => queueItem(word, ladderOf(states, word.id))).filter((word) => !status || word.status === status);
  }); }
  async addWordToMyWordbook(clientId: string, wordbookId: string, entry: StudyWordEntry): Promise<{ word: LearningQueueItem; created: boolean } | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === wordbookId && !item.deletedAt); if (!book) return null;
    // Words are stored normalized; dedupe on an exact normalized match.
    const states = ladderStates(client.events.filter((event) => event.wordbookId === wordbookId));
    const existing = book.words.find((word) => word.word === entry.word);
    if (existing) return { word: queueItem(existing, ladderOf(states, existing.id)), created: false };
    const at = this.now().toISOString();
    const added: WordbookWord = { ...clone(entry), id: randomUUID(), addedAt: at };
    book.words.push(added); book.updatedAt = at;
    return { word: queueItem(added, ladderOf(states, added.id)), created: true };
  }); }
  async purgeMyWordbook(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const index = client.wordbooks.findIndex((item) => item.id === id && item.deletedAt);
    if (index < 0) return false;
    client.wordbooks.splice(index, 1); client.events = client.events.filter((event) => event.wordbookId !== id); return true;
  }); }
  async deleteCatalogUpload(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => {
    const index = state.catalog.findIndex((book) => book.id === id && book.ownerClientId === clientId);
    if (index < 0) return false;
    state.catalog.splice(index, 1);
    // Copies other clients made via "add" are independent snapshots and stay; only
    // the marketplace listing and every client's favorite reference to it are removed.
    for (const client of Object.values(state.clients)) client.favorites = client.favorites.filter((favorite) => favorite !== id);
    return true;
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
    book.updatedAt = this.now().toISOString();
    // A rename keeps the word id, so its replayed proficiency survives unchanged.
    const ladderState = ladderOf(ladderStates(client.events.filter((event) => event.wordbookId === wordbookId)), target.id);
    return { kind: "updated", word: studiedWord(target, ladderState) };
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
    const event: LearningEvent = input.kind === "new" ? { ...common, kind: "new", ...(input.verdict ? { verdict: input.verdict } : {}) } : input.kind === "flashcard" ? { ...common, kind: "flashcard", verdict: input.verdict } : input.kind === "dictation" ? { ...common, kind: "dictation", correct: input.correct } : { ...common, kind: "mark", level: input.level };
    client.events.push(event); book.updatedAt = event.occurredAt; return event;
  }); }
  async getDashboard(clientId: string, id: string): Promise<StudyDashboard | null> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null;
    const now = this.now(); const today = day(now); const events = client.events.filter((event) => event.wordbookId === id);
    // "mark" events are manual overrides, not study effort: excluded from calendar/streak/week and
    // today's completed tallies, but still surfaced in recentActivity (with their level) below.
    const studyEvents = events.filter((event) => event.kind !== "mark");
    const todayEvents = studyEvents.filter((event) => day(new Date(event.occurredAt)) === today);
    const count = (items: LearningEvent[], kind: LearningEvent["kind"]) => items.filter((event) => event.kind === kind).length;
    const completedNew = count(todayEvents, "new"); const completedReview = count(todayEvents, "flashcard"); const completedDictation = count(todayEvents, "dictation");
    const states = ladderStates(events); const bookProgress = progress(book, events); const { levels } = bookProgress;
    // Availability per contract: 新词学习 from l0, 听写训练 from l2+l3+l4; 复习巩固 is the DUE count (below).
    const newAvailable = levels.l0; const dictationAvailable = levels.l2 + levels.l3 + levels.l4;
    // One walk of the word list feeds two spaced-review widgets:
    //   复习巩固 availability = L1|L2 words whose calendar-day gap has elapsed (reviewDue).
    //   终审待办 (finalCheckDue) = L3 words whose 7-day window has passed — next correct dictation reaches L4.
    let reviewAvailable = 0; let finalCheckDue = 0;
    for (const word of book.words) {
      const s = ladderOf(states, word.id);
      if (reviewDue(s, now)) reviewAvailable += 1;
      if (s.level === 3 && s.levelReachedAt !== undefined && now.getTime() - Date.parse(s.levelReachedAt) >= FINAL_CHECK_WINDOW_MS) finalCheckDue += 1;
    }
    const perDay = new Map<string, number>(); for (const event of studyEvents) { const key = day(new Date(event.occurredAt)); perDay.set(key, (perDay.get(key) ?? 0) + 1); }
    const calendar = Array.from({ length: 7 }, (_, index) => { const date = day(shiftDay(now, index - 6)); const amount = perDay.get(date) ?? 0; return { date, count: amount, active: amount > 0 }; });
    let streak = 0; for (let offset = 0; offset < 365; offset += 1) { if (!perDay.get(day(shiftDay(now, -offset)))) break; streak += 1; }
    // Same 7 calendar days as the calendar block so both widgets always agree.
    const weekDays = new Set(calendar.map((item) => item.date));
    const weekEvents = studyEvents.filter((event) => weekDays.has(day(new Date(event.occurredAt))));
    const weekNew = count(weekEvents, "new"); const weekReview = count(weekEvents, "flashcard"); const weekDictation = count(weekEvents, "dictation");
    // The 结果 column shows the proficiency a word held right after each study action.
    const afterById = ladderEventLevels(events);
    // Reverse first so equal-millisecond events retain newest-insertion-first
    // ordering under JavaScript's stable sort.
    return { wordbook: card(book, events), todayPlan: { new: { target: Math.min(20, Math.max(completedNew, newAvailable)), completed: completedNew }, review: { target: Math.min(30, Math.max(completedReview, reviewAvailable)), completed: completedReview }, dictation: { target: Math.min(15, Math.max(completedDictation, dictationAvailable)), completed: completedDictation } }, recentActivity: clone([...events].reverse().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5)).map((event) => ({ ...event, levelAfter: afterById.get(event.id) ?? 0 as WordLevel })), calendar, week: { newCount: weekNew, reviewCount: weekReview, dictationCount: weekDictation, total: weekNew + weekReview + weekDictation }, streakDays: streak, finalCheckDue, updatedAt: book.updatedAt };
  }); }

  // --- Shared state plumbing ---
  private client(state: State, id: string): ClientData { return state.clients[id] ??= defaultClient(); }
  /** Read-only view: never inserts a client record, so GETs cannot grow the persisted state. */
  private clientView(state: State, id: string): ClientData { return state.clients[id] ?? defaultClient(); }
  /** 12 hexadecimal characters = 48 bits; legacy 6–8 character codes remain importable. */
  private shareCode(state: State): string { let code = ""; do { code = randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase(); } while (state.catalog.some((book) => book.shareCode === code)); return code; }
  private async read<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => operation(await this.state())); this.queue = task.then(() => undefined, () => undefined); return await task; }
  private async mutate<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => {
    const previous = await this.state();
    const draft = clone(previous);
    const value = operation(draft);
    await this.save(draft, previous);
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
export class InMemoryStudyStore extends BaseStore { constructor(options: { now?: () => Date } = {}) { super(options.now); } protected async load(): Promise<State> { return EMPTY(); } protected async save(_state: State, _previous?: State): Promise<void> {} }
export class JsonFileStudyStore extends BaseStore {
  private readonly filePath: string;
  constructor(filePath: string, options: { now?: () => Date } = {}) { super(options.now); this.filePath = resolve(filePath); }
  protected async load(): Promise<State> { try { return migrate(JSON.parse(await readFile(this.filePath, "utf8")) as unknown); } catch (error) { if (isJsonObject(error) && error.code === "ENOENT") return EMPTY(); throw error; } }
  protected async save(state: State, _previous?: State): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temp, this.filePath); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
}
