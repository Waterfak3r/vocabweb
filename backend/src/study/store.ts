import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import { isJsonObject } from "./validation.js";
import {
  applyCatalogChanges,
  catalogAtRevision,
  catalogDiffStats,
  diffCatalogWords,
  inverseRevisionAgainstHead,
  meaningfulCatalogChanges,
  sameCatalogWord,
  threeWayContribution,
  validateContributionMerge,
} from "./collaboration.js";
import {
  BATCH_SIZE, DEFAULT_WORDBOOK_STUDY_PREFERENCES, RETENTION_MS, card, catalogCard as buildCatalogCard, clone, compactLearningEvents, day, defaultClient,
  EMPTY, ladderEventLevels, ladderOf, ladderStates, migrate, progress, queueItem, replayLadder, reviewDue, reviewLane, reviewScheduleOf,
  sameMeanings, shiftDay, studiedWord, toCatalogWords, toWordbookWords, visibleTo,
} from "./ladder.js";
import type { ClientData, State } from "./ladder.js";
import type {
  AccountUser, BatchWordInput, BatchWordResult, CatalogAuthor, CatalogCard, CatalogConflict, CatalogContribution, CatalogContributionView,
  CatalogQuery, CatalogRevision, CatalogRevisionSummary, CatalogRevisionView, CatalogWordChange, CatalogWordbook,
  CatalogUpdateMutationResult, CommitImportDraftInput, ContributionMutationResult, ContributionPreview, CreateCatalogContributionInput, CreateImportDraftInput, CreateMyWordbookInput,
  CursorPage, CursorQuery,
  ImportDraft, ImportDraftEntry, LearningEvent, LearningEventInput, LearningQueueItem, MyWordbook, MyWordbookCard,
  MeaningPreference, ResolveCatalogContributionInput, ResolvedImportDraftEntry, RevertPreview, RevertRevisionInput, ReviewSchedule, RevisionMutationResult,
  StartStudyRoundInput, StudyChoiceOption, StudyDashboard, StudyRound, StudyRoundAnswerInput, StudyRoundMutationResult,
  StudyRoundTask, StudyRoundTaskOptions, StudyStore, StudyWordEntry, SyncedStudySettings, UpdateCatalogWordbookInput, UpdateMyWordbookInput,
  UpdateStudySettingsInput, UpdateWordInput, UpdateWordResult, UploadCatalogWordbookInput, WordbookStudyPreferences, WordbookWord,
  WordLearningStatus, WordLevel,
} from "./types.js";

export { EMPTY, migrate };
export type { ClientData, State };

export type StudyResourceLimits = {
  maxWordbooksPerClient: number;
  maxWordsPerClient: number;
  maxDraftsPerClient: number;
};

export const DEFAULT_STUDY_RESOURCE_LIMITS: StudyResourceLimits = {
  maxWordbooksPerClient: 50,
  maxWordsPerClient: 50_000,
  maxDraftsPerClient: 20,
};

const STUDY_ROUND_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STUDY_ROUNDS_PER_CLIENT = 20;
const MAX_PROCESSED_ROUND_OPERATIONS = 2_000;
const COMMON_PREFIXES = [
  "anti", "auto", "counter", "inter", "micro", "mis", "multi", "non", "over", "post", "pre", "re", "semi", "sub", "super", "trans", "un", "under",
] as const;
const COMMON_SUFFIXES = [
  "ability", "ation", "ible", "able", "ality", "ingly", "ment", "ness", "less", "ful", "tion", "sion", "ance", "ence", "ative", "itive", "ous", "ive", "ize", "ise", "ify", "ing", "ed", "er", "est", "ly",
] as const;

function preferencesOf(book: MyWordbook): WordbookStudyPreferences {
  return clone(book.studyPreferences ?? DEFAULT_WORDBOOK_STUDY_PREFERENCES);
}

function roundTaskKey(task: Pick<StudyRoundTask, "wordId" | "exercise">): string {
  return `${task.wordId}:${task.exercise}`;
}

function dueTimestamp(state: ReturnType<typeof ladderOf>): number {
  const value = state.nextReviewAt ?? state.lastStudiedAt;
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRoundTasks(wordIds: string[], exercises: StudyRound["exerciseTypes"]): StudyRoundTask[] {
  const tasks: StudyRoundTask[] = [];
  exercises.forEach((exercise, exerciseIndex) => {
    // A second pass starts halfway around the list, so the answer just seen for one word is not
    // immediately reused in its other exercise.
    const offset = exerciseIndex === 0 || wordIds.length < 2 ? 0 : Math.ceil(wordIds.length / 2);
    const ordered = offset ? [...wordIds.slice(offset), ...wordIds.slice(0, offset)] : wordIds;
    for (const wordId of ordered) tasks.push({ id: randomUUID(), wordId, exercise });
  });
  return tasks;
}

function stripAffixes(word: string): Set<string> {
  const roots = new Set<string>([word]);
  for (const prefix of COMMON_PREFIXES) {
    if (word.startsWith(prefix) && word.length - prefix.length >= 4) roots.add(word.slice(prefix.length));
  }
  for (const suffix of COMMON_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) roots.add(word.slice(0, -suffix.length));
  }
  for (const root of [...roots]) {
    for (const suffix of COMMON_SUFFIXES) {
      if (root.endsWith(suffix) && root.length - suffix.length >= 4) roots.add(root.slice(0, -suffix.length));
    }
  }
  return roots;
}

function sharedEdge(left: string, right: string, fromEnd = false): number {
  const a = fromEnd ? [...left].reverse().join("") : left;
  const b = fromEnd ? [...right].reverse().join("") : right;
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function bigrams(word: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < word.length - 1; index += 1) result.add(word.slice(index, index + 2));
  return result;
}

function spellingSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  let shared = 0;
  for (const pair of a) if (b.has(pair)) shared += 1;
  return shared / Math.max(1, a.size + b.size - shared);
}

function lexicalSimilarity(target: string, candidate: string): number {
  const targetRoots = stripAffixes(target);
  const candidateRoots = stripAffixes(candidate);
  let score = 0;
  if ([...targetRoots].some((root) => candidateRoots.has(root) && root.length >= 4)) score += 120;
  if ([...targetRoots].some((root) => root.length >= 4 && (candidate.includes(root) || [...candidateRoots].some((other) => other.includes(root))))) score += 70;
  if (COMMON_PREFIXES.some((prefix) => target.startsWith(prefix) && candidate.startsWith(prefix))) score += 30;
  if (COMMON_SUFFIXES.some((suffix) => target.endsWith(suffix) && candidate.endsWith(suffix))) score += 30;
  score += Math.min(4, sharedEdge(target, candidate)) * 5;
  score += Math.min(4, sharedEdge(target, candidate, true)) * 5;
  score += spellingSimilarity(target, candidate) * 40;
  score -= Math.abs(target.length - candidate.length) * 1.5;
  return score;
}

function stableHash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function completedReviewLanes(
  events: LearningEvent[],
  schedule: ReviewSchedule,
  today: string,
): { protected: Set<string>; regular: Set<string>; backlog: Set<string> } {
  const result = { protected: new Set<string>(), regular: new Set<string>(), backlog: new Set<string>() };
  const history = new Map<string, LearningEvent[]>();
  const startingLane = new Map<string, keyof typeof result | null>();
  for (const event of events) {
    const bucket = history.get(event.wordId) ?? [];
    const eventDay = day(new Date(event.occurredAt));
    if (event.kind === "flashcard" && eventDay === today) {
      if (!startingLane.has(event.wordId)) {
        startingLane.set(event.wordId, reviewLane(replayLadder(bucket, undefined, schedule), new Date(event.occurredAt), schedule));
      }
      if (event.verdict === "know") {
        const lane = startingLane.get(event.wordId);
        if (lane) result[lane].add(event.wordId);
      }
    }
    bucket.push(event);
    history.set(event.wordId, bucket);
  }
  return result;
}

export class StudyResourceLimitError extends Error {
  constructor(public readonly resource: "wordbooks" | "words" | "drafts") {
    super(`Study ${resource} limit exceeded`);
    this.name = "StudyResourceLimitError";
  }
}

export abstract class BaseStore implements StudyStore {
  private statePromise: Promise<State> | undefined;
  private queue: Promise<void> = Promise.resolve();
  protected constructor(
    protected readonly now: () => Date = () => new Date(),
    private readonly limits: StudyResourceLimits = DEFAULT_STUDY_RESOURCE_LIMITS,
  ) {}
  protected abstract load(): Promise<State>;
  /** Persist one state transition; record-oriented stores can diff against `previous`. */
  protected abstract save(state: State, previous?: State): Promise<void>;
  /** Persistent stores can invalidate cached state after detecting another writer. */
  protected async refreshBeforeOperation(): Promise<void> {}
  protected clearCachedState(): void {
    this.statePromise = undefined;
  }

  // --- Accounts & sessions ---
  async createUser(username: string, passwordHash: string, clientId: string): Promise<{ kind: "created"; user: AccountUser } | { kind: "taken" } | { kind: "client-taken" }> { return await this.mutate((state) => {
    const lower = username.toLowerCase();
    if (state.users.some((user) => user.username.toLowerCase() === lower)) return { kind: "taken" as const };
    if (state.users.some((user) => user.clientId === clientId)) return { kind: "client-taken" as const };
    const user: AccountUser = { id: `user-${randomUUID()}`, username, passwordHash, clientId, role: "user", createdAt: this.now().toISOString() };
    state.users.push(user);
    // Registering adopts the requesting anonymous client as the account's data home.
    this.client(state, clientId);
    return { kind: "created" as const, user: clone(user) };
  }); }
  async getUserByUsername(username: string): Promise<AccountUser | null> { return await this.read((state) => { const lower = username.toLowerCase(); const user = state.users.find((item) => item.username.toLowerCase() === lower); return user ? clone(user) : null; }); }
  async getUserById(id: string): Promise<AccountUser | null> { return await this.read((state) => { const user = state.users.find((item) => item.id === id); return user ? clone(user) : null; }); }
  async getUserByClientId(clientId: string): Promise<AccountUser | null> { return await this.read((state) => { const user = state.users.find((item) => item.clientId === clientId); return user ? clone(user) : null; }); }
  async setUserRole(username: string, role: AccountUser["role"]): Promise<AccountUser | null> { return await this.mutate((state) => {
    const lower = username.toLowerCase();
    const user = state.users.find((item) => item.username.toLowerCase() === lower);
    if (!user) return null;
    user.role = role;
    return clone(user);
  }); }
  async updateUserPassword(userId: string, passwordHash: string, keepSessionTokenHash: string): Promise<AccountUser | null> { return await this.mutate((state) => {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return null;
    user.passwordHash = passwordHash;
    state.sessions = state.sessions.filter(
      (session) => session.userId !== userId || session.tokenHash === keepSessionTokenHash,
    );
    return clone(user);
  }); }
  async exportUserData(userId: string): Promise<unknown | null> { return await this.read((state) => {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return null;
    return {
      account: { username: user.username, role: user.role, createdAt: user.createdAt },
      collection: clone(this.clientView(state, user.clientId)),
      catalogUploads: clone(state.catalog.filter((book) => book.authorUserId === user.id)),
      contributions: clone(state.contributions.filter((contribution) => contribution.contributorUserId === user.id)),
      revisions: clone(state.revisions.filter(
        (revision) => revision.authorUserId === user.id || revision.committerUserId === user.id,
      )),
    };
  }); }
  async deleteUser(userId: string): Promise<boolean> { return await this.mutate((state) => {
    const index = state.users.findIndex((item) => item.id === userId);
    if (index < 0) return false;
    const [user] = state.users.splice(index, 1);
    if (!user) return false;
    state.sessions = state.sessions.filter((session) => session.userId !== userId);
    delete state.clients[user.clientId];
    const removedCatalogIds = new Set(
      state.catalog.filter((book) => book.authorUserId === userId || book.ownerClientId === user.clientId).map((book) => book.id),
    );
    state.catalog = state.catalog.filter((book) => !removedCatalogIds.has(book.id));
    state.revisions = state.revisions.filter((revision) => !removedCatalogIds.has(revision.catalogId));
    state.contributions = state.contributions.filter((contribution) => {
      if (removedCatalogIds.has(contribution.catalogId)) return false;
      if (contribution.contributorUserId !== userId) return true;
      if (contribution.status !== "merged") return false;
      delete contribution.contributorUserId;
      contribution.contributor = "已注销用户";
      return true;
    });
    for (const revision of state.revisions) {
      if (revision.authorUserId === userId) {
        delete revision.authorUserId;
        revision.author = "已注销用户";
      }
      if (revision.committerUserId === userId) {
        delete revision.committerUserId;
        revision.committer = "已注销用户";
      }
    }
    for (const client of Object.values(state.clients)) {
      client.favorites = client.favorites.filter((id) => !removedCatalogIds.has(id));
    }
    return true;
  }); }
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
    if (!source || (!source.wordbooks.length && !source.events.length && !source.drafts.length && !source.favorites.length && !source.studySettings && !source.studyRounds.length)) return;
    const target = this.client(state, intoClientId);
    const incoming = clone(source);
    // A migrated/crafted data file can contain ids that already exist in the account
    // home. Remap only colliding ids and rewrite every dependent reference.
    const usedBookIds = new Set(target.wordbooks.map((book) => book.id));
    const usedWordIds = new Set(target.wordbooks.flatMap((book) => book.words.map((word) => word.id)));
    const usedEventIds = new Set(target.events.map((event) => event.id));
    const usedDraftIds = new Set(target.drafts.map((draft) => draft.id));
    const usedDraftEntryIds = new Set(target.drafts.flatMap((draft) => draft.entries.map((entry) => entry.id)));
    const usedRoundIds = new Set(target.studyRounds.map((round) => round.id));
    const usedRoundTaskIds = new Set(target.studyRounds.flatMap((round) => round.queue.map((task) => task.id)));
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
    for (const round of incoming.studyRounds) {
      const oldBookId = round.wordbookId;
      round.wordbookId = bookIds.get(oldBookId) ?? oldBookId;
      round.wordIds = round.wordIds.map((wordId) => wordIds.get(`${oldBookId}:${wordId}`) ?? wordId);
      round.queue = round.queue.map((task) => {
        const id = usedRoundTaskIds.has(task.id) ? randomUUID() : task.id;
        usedRoundTaskIds.add(id);
        return { ...task, id, wordId: wordIds.get(`${oldBookId}:${task.wordId}`) ?? task.wordId };
      });
      round.completedWordIds = round.completedWordIds.map((wordId) => wordIds.get(`${oldBookId}:${wordId}`) ?? wordId);
      round.vagueWordIds = round.vagueWordIds.map((wordId) => wordIds.get(`${oldBookId}:${wordId}`) ?? wordId);
      round.unknownWordIds = round.unknownWordIds.map((wordId) => wordIds.get(`${oldBookId}:${wordId}`) ?? wordId);
      round.passedTaskKeys = round.passedTaskKeys.map((key) => {
        const separator = key.lastIndexOf(":");
        if (separator < 0) return key;
        const oldWordId = key.slice(0, separator);
        return `${wordIds.get(`${oldBookId}:${oldWordId}`) ?? oldWordId}:${key.slice(separator + 1)}`;
      });
      if (usedRoundIds.has(round.id)) round.id = randomUUID();
      usedRoundIds.add(round.id);
    }
    target.wordbooks.push(...incoming.wordbooks);
    target.events.push(...incoming.events);
    target.drafts.push(...incoming.drafts);
    const activeKeys = new Set(
      target.studyRounds
        .filter((round) => !round.completedAt && Date.parse(round.expiresAt) > this.now().getTime())
        .map((round) => `${round.wordbookId}:${round.mode}:${round.scope}`),
    );
    target.studyRounds.push(...incoming.studyRounds.filter((round) => {
      const key = `${round.wordbookId}:${round.mode}:${round.scope}`;
      if (!round.completedAt && Date.parse(round.expiresAt) > this.now().getTime() && activeKeys.has(key)) return false;
      activeKeys.add(key);
      return true;
    }));
    target.favorites = [...new Set([...target.favorites, ...source.favorites])];
    // Existing account settings win when a new browser signs in. A legacy account
    // with no cloud settings adopts the anonymous browser's first synced values.
    if (!target.studySettings && incoming.studySettings) target.studySettings = incoming.studySettings;
    // Owned catalog listings follow the merged client home; author attribution is untouched.
    for (const book of state.catalog) if (book.ownerClientId === fromClientId) {
      book.ownerClientId = intoClientId;
      if (book.sourceWordbookId) book.sourceWordbookId = bookIds.get(book.sourceWordbookId) ?? book.sourceWordbookId;
    }
    // Anonymous and account identities may both have adopted the same catalog
    // before login. Collapse them to one durable adopter and recompute the count.
    for (const book of state.catalog) {
      const adopters = new Set(book.adopterClientIds ?? []);
      if (!adopters.delete(fromClientId)) continue;
      adopters.add(intoClientId);
      book.adopterClientIds = [...adopters];
      book.uses = (book.legacyUses ?? 0) + adopters.size;
    }
    // The now-empty source home is retired so a repeat merge is a no-op.
    delete state.clients[fromClientId];
  }); }

  // --- Catalog & marketplace ---
  async listCatalog(clientId: string, query: CatalogQuery): Promise<CatalogCard[]> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const q = query.q?.toLowerCase();
    // The public marketplace lists public entries only; unlisted/private stay off the shelves.
    const books = state.catalog.filter((book) => book.visibility === "public" && (!q || `${book.title} ${book.description} ${book.author}`.toLowerCase().includes(q)) && (!query.exam || book.exams.includes(query.exam)) && (!query.goal || book.goals.includes(query.goal)));
    const ordered = [...books].sort((a, b) => query.sort === "hot" ? b.uses - a.uses : query.sort === "newest" ? b.updatedAt.localeCompare(a.updatedAt) : query.sort === "rating" ? b.rating - a.rating : b.uses - a.uses);
    return ordered.map((book) => this.catalogCard(state, book, client, clientId));
  }); }
  async listFavorites(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => {
    const client = this.clientView(state, clientId);
    // Keep an already-favorited unlisted entry manageable, while private remains owner-only.
    return state.catalog.filter((book) => client.favorites.includes(book.id) && (book.visibility !== "private" || book.ownerClientId === clientId)).map((book) => this.catalogCard(state, book, client, clientId));
  }); }
  async listUploads(clientId: string): Promise<CatalogCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return state.catalog.filter((book) => book.ownerClientId === clientId).map((book) => this.catalogCard(state, book, client, clientId)); }); }
  async getCatalog(clientId: string, id: string) { return await this.read((state) => {
    const found = state.catalog.find((book) => book.id === id);
    if (!found || !visibleTo(found, clientId)) return null;
    return { ...this.catalogCard(state, found, this.clientView(state, clientId), clientId), words: clone(found.words) };
  }); }
  async toggleFavorite(clientId: string, id: string): Promise<{ favorited: boolean; favoriteCount: number } | null> { return await this.mutate((state) => {
    const book = state.catalog.find((item) => item.id === id);
    const client = this.client(state, clientId); const index = client.favorites.indexOf(id);
    if (!book || (index < 0 && !visibleTo(book, clientId)) || (index >= 0 && book.visibility === "private" && book.ownerClientId !== clientId)) return null;
    if (index >= 0) { client.favorites.splice(index, 1); return { favorited: false, favoriteCount: this.favoriteCount(state, id) }; }
    client.favorites.push(id); return { favorited: true, favoriteCount: this.favoriteCount(state, id) };
  }); }
  async addCatalogToMine(clientId: string, id: string): Promise<{ wordbook: MyWordbookCard; created: boolean } | null> { return await this.mutate((state) => {
    const source = state.catalog.find((book) => book.id === id); if (!source || !visibleTo(source, clientId)) return null;
    const client = this.client(state, clientId); const existing = client.wordbooks.find((book) => !book.deletedAt && book.sourceCatalogId === id);
    if (existing) return { wordbook: card(existing, client.events), created: false };
    this.recordAdoption(source, clientId); const at = this.now().toISOString();
    const book: MyWordbook = {
      id: `my-${randomUUID()}`,
      title: source.title,
      description: source.description,
      sourceCatalogId: source.id,
      sourceRevisionId: source.headRevisionId,
      createdAt: at,
      updatedAt: at,
      words: toWordbookWords(source.words, at),
    };
    client.wordbooks.push(book); return { wordbook: card(book, client.events), created: true };
  }); }
  async uploadCatalog(clientId: string, input: UploadCatalogWordbookInput): Promise<CatalogCard | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const source = input.sourceWordbookId ? client.wordbooks.find((item) => item.id === input.sourceWordbookId && !item.deletedAt) : undefined;
    if (input.sourceWordbookId && !source) return null;
    const now = this.now().toISOString();
    const revisionId = `revision-${randomUUID()}`;
    const words = source ? toCatalogWords(source.words) : clone(input.words ?? []);
    const book: CatalogWordbook = {
      id: `catalog-${randomUUID()}`,
      title: input.title ?? source?.title ?? "",
      description: input.description ?? source?.description ?? "",
      // An authenticated upload is attributed to its username; anonymous uploads read "匿名".
      author: input.author?.username ?? "匿名", exams: input.exams ?? [], goals: input.goals ?? [], rating: 0, uses: 0, createdAt: now, updatedAt: now,
      headRevisionId: revisionId,
      visibility: input.visibility ?? "public",
      shareCode: this.shareCode(state), words, ownerClientId: clientId,
      ...(input.author ? { authorUserId: input.author.userId } : {}),
      ...(source ? { sourceWordbookId: source.id } : {}),
    };
    const changes = diffCatalogWords([], words);
    state.revisions.push({
      id: revisionId,
      catalogId: book.id,
      kind: "initial",
      message: input.message ?? "首次发布",
      ...(input.author ? { authorUserId: input.author.userId } : {}),
      author: input.author?.username ?? "匿名",
      createdAt: now,
      changes,
      stats: catalogDiffStats(changes),
    });
    state.catalog.push(book);
    return this.catalogCard(state, book, client, clientId);
  }); }
  async upsertSeedCatalog(clientId: string, input: UploadCatalogWordbookInput & { seedKey: string; author: { userId: string; username: string } }): Promise<CatalogCard> { return await this.mutate((state) => {
    const client = this.client(state, clientId);
    const existing = state.catalog.find((book) => book.seedKey === input.seedKey);
    if (existing) {
      const previousWords = clone(existing.words);
      const nextTitle = input.title ?? existing.title;
      const nextDescription = input.description ?? existing.description;
      const nextExams = clone(input.exams ?? []);
      const nextGoals = clone(input.goals ?? []);
      const nextWords = clone(input.words ?? []);
      const metadataChanged = existing.title !== nextTitle
        || existing.description !== nextDescription
        || JSON.stringify(existing.exams) !== JSON.stringify(nextExams)
        || JSON.stringify(existing.goals) !== JSON.stringify(nextGoals);
      existing.title = input.title ?? existing.title;
      existing.description = input.description ?? existing.description;
      existing.exams = nextExams;
      existing.goals = nextGoals;
      existing.words = nextWords;
      existing.visibility = "public";
      existing.author = input.author.username;
      existing.authorUserId = input.author.userId;
      existing.ownerClientId = clientId;
      const now = this.now().toISOString();
      const sourceId = `my-seed-${input.seedKey}`;
      const source = this.upsertSeedSource(client, sourceId, input.title ?? existing.title, input.description ?? existing.description, input.words ?? [], now);
      existing.sourceWordbookId = source.id;
      const changes = diffCatalogWords(previousWords, nextWords);
      if (metadataChanged || changes.length) {
        const revision: CatalogRevision = {
          id: `revision-${randomUUID()}`,
          catalogId: existing.id,
          parentRevisionId: existing.headRevisionId,
          kind: "update",
          message: input.message ?? "更新词书",
          authorUserId: input.author.userId,
          author: input.author.username,
          createdAt: now,
          changes,
          stats: catalogDiffStats(changes),
        };
        state.revisions.push(revision);
        existing.headRevisionId = revision.id;
        existing.updatedAt = now;
      }
      return this.catalogCard(state, existing, client, clientId);
    }
    const now = this.now().toISOString();
    const revisionId = `revision-${randomUUID()}`;
    const sourceId = `my-seed-${input.seedKey}`;
    const source = this.upsertSeedSource(client, sourceId, input.title ?? "", input.description ?? "", input.words ?? [], now);
    const book: CatalogWordbook = {
      id: `catalog-seed-${input.seedKey}`,
      seedKey: input.seedKey,
      title: input.title ?? "",
      description: input.description ?? "",
      author: input.author.username,
      authorUserId: input.author.userId,
      exams: clone(input.exams ?? []),
      goals: clone(input.goals ?? []),
      rating: 0,
      uses: 0,
      createdAt: now,
      updatedAt: now,
      headRevisionId: revisionId,
      visibility: "public",
      shareCode: this.shareCode(state),
      words: clone(input.words ?? []),
      ownerClientId: clientId,
      sourceWordbookId: source.id,
      legacyUses: 0,
      adopterClientIds: [],
    };
    const changes = diffCatalogWords([], book.words);
    state.revisions.push({
      id: revisionId,
      catalogId: book.id,
      kind: "initial",
      message: input.message ?? "首次发布",
      authorUserId: input.author.userId,
      author: input.author.username,
      createdAt: now,
      changes,
      stats: catalogDiffStats(changes),
    });
    state.catalog.push(book);
    return this.catalogCard(state, book, client, clientId);
  }); }
  async updateCatalog(clientId: string, id: string, input: UpdateCatalogWordbookInput): Promise<CatalogUpdateMutationResult> { return await this.mutate((state) => {
    const catalog = state.catalog.find((item) => item.id === id && item.ownerClientId === clientId);
    if (!catalog) return { kind: "not-found" };
    const client = this.client(state, clientId);
    if (input.sourceWordbookId !== undefined) {
      if (!input.expectedHeadRevisionId) {
        return { kind: "head-required", headRevisionId: catalog.headRevisionId };
      }
      if (input.expectedHeadRevisionId !== catalog.headRevisionId) {
        return { kind: "stale", headRevisionId: catalog.headRevisionId };
      }
      const linkedSource = catalog.sourceWordbookId
        ? client.wordbooks.find((item) => item.id === catalog.sourceWordbookId && !item.deletedAt)
        : undefined;
      if (linkedSource && linkedSource.id !== input.sourceWordbookId) {
        return {
          kind: "source-mismatch",
          headRevisionId: catalog.headRevisionId,
          sourceWordbookId: linkedSource.id,
        };
      }
    }
    const source = input.sourceWordbookId
      ? client.wordbooks.find((item) => item.id === input.sourceWordbookId && !item.deletedAt)
      : undefined;
    if (input.sourceWordbookId && !source) return { kind: "not-found" };
    const previousWords = clone(catalog.words);
    const previousTitle = catalog.title;
    const previousDescription = catalog.description;
    const previousExams = clone(catalog.exams);
    const previousGoals = clone(catalog.goals);
    if (source) { catalog.words = toCatalogWords(source.words); catalog.sourceWordbookId = source.id; }
    if (input.title !== undefined) catalog.title = input.title;
    if (input.description !== undefined) catalog.description = input.description;
    if (input.exams !== undefined) catalog.exams = clone(input.exams);
    if (input.goals !== undefined) catalog.goals = clone(input.goals);
    if (input.visibility !== undefined) catalog.visibility = input.visibility;
    // Going public (or any authenticated edit) re-attributes the entry to the acting account.
    if (input.author !== undefined) { catalog.author = input.author.username; catalog.authorUserId = input.author.userId; }
    const changes = diffCatalogWords(previousWords, catalog.words);
    const metadataChanged = previousTitle !== catalog.title
      || previousDescription !== catalog.description
      || JSON.stringify(previousExams) !== JSON.stringify(catalog.exams)
      || JSON.stringify(previousGoals) !== JSON.stringify(catalog.goals);
    const snapshotUpdated = changes.length > 0 || metadataChanged;
    if (snapshotUpdated) {
      const at = this.now().toISOString();
      const revision: CatalogRevision = {
        id: `revision-${randomUUID()}`,
        catalogId: catalog.id,
        parentRevisionId: catalog.headRevisionId,
        kind: "update",
        message: input.message ?? "更新词书",
        ...(input.author ? { authorUserId: input.author.userId } : {}),
        author: input.author?.username ?? catalog.author,
        createdAt: at,
        changes,
        stats: catalogDiffStats(changes),
      };
      state.revisions.push(revision);
      catalog.headRevisionId = revision.id;
      catalog.updatedAt = at;
    }
    if (catalog.visibility !== "public") {
      const at = this.now().toISOString();
      for (const contribution of state.contributions) {
        if (contribution.catalogId !== catalog.id || contribution.status !== "open") continue;
        contribution.status = "closed";
        contribution.updatedAt = at;
        contribution.handledAt = at;
        contribution.resolutionNote = "词书已停止公开";
        if (input.author) {
          contribution.handledByUserId = input.author.userId;
          contribution.handledBy = input.author.username;
        }
      }
    }
    return { kind: "updated", catalog: this.catalogCard(state, catalog, client, clientId) };
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
      this.recordAdoption(source, clientId);
      const at = this.now().toISOString();
      const book: MyWordbook = {
        id: `my-${randomUUID()}`, title: source.title, description: source.description,
        sourceCatalogId: source.id, sourceRevisionId: source.headRevisionId,
        createdAt: at, updatedAt: at, words: toWordbookWords(source.words, at),
      };
      client.wordbooks.push(book);
      return { wordbook: card(book, client.events), created: true };
    });
  }

  // --- Catalog collaboration, immutable revisions, and reverts ---
  async getContributionPreview(clientId: string, userId: string, wordbookId: string): Promise<ContributionPreview | null> {
    return await this.read((state) => {
      const result = this.contributionPreview(state, clientId, userId, wordbookId);
      return result.kind === "ready" ? clone(result.preview) : null;
    });
  }

  async createContribution(
    clientId: string,
    author: CatalogAuthor,
    catalogId: string,
    input: CreateCatalogContributionInput,
  ): Promise<ContributionMutationResult> {
    return await this.mutate((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      if (!catalog) return { kind: "not-found" };
      if (!this.collaborationEnabled(state, catalog)) return { kind: "disabled" };
      const client = this.client(state, clientId);
      const source = client.wordbooks.find(
        (book) => !book.deletedAt && book.sourceCatalogId === catalogId,
      );
      if (!source) return { kind: "not-found" };
      const previewResult = this.contributionPreview(state, clientId, author.userId, source.id);
      if (previewResult.kind === "disabled") return { kind: "disabled" };
      if (previewResult.kind !== "ready") return { kind: "not-found" };
      const preview = previewResult.preview;
      if (
        input.expectedHeadRevisionId !== preview.expectedHeadRevisionId
        || input.expectedSourceUpdatedAt !== preview.expectedSourceUpdatedAt
      ) {
        return {
          kind: "stale",
          headRevisionId: preview.expectedHeadRevisionId,
          sourceUpdatedAt: preview.expectedSourceUpdatedAt,
        };
      }
      const duplicate = state.contributions.find(
        (contribution) => contribution.catalogId === catalogId
          && contribution.contributorUserId === author.userId
          && contribution.status === "open",
      );
      if (duplicate) return { kind: "duplicate-open", contributionId: duplicate.id };
      if (!preview.changes.length) return { kind: "empty" };
      if (preview.changes.length > 500) return { kind: "too-large", count: preview.changes.length };
      const at = this.now().toISOString();
      const contribution: CatalogContribution = {
        id: `contribution-${randomUUID()}`,
        catalogId,
        sourceWordbookId: source.id,
        contributorUserId: author.userId,
        contributor: author.username,
        baseRevisionId: preview.baseRevisionId,
        submittedHeadRevisionId: preview.headRevisionId,
        title: input.title,
        description: input.description ?? "",
        status: "open",
        changes: clone(preview.changes),
        stats: catalogDiffStats(preview.changes),
        createdAt: at,
        updatedAt: at,
      };
      state.contributions.push(contribution);
      return {
        kind: "created",
        contribution: this.contributionView(catalog, contribution, author.userId),
      };
    });
  }

  async listCatalogContributions(
    clientId: string,
    userId: string | undefined,
    catalogId: string,
    query: CursorQuery,
  ): Promise<CursorPage<CatalogContributionView> | null> {
    return await this.read((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      if (!catalog || (catalog.visibility !== "public" && catalog.ownerClientId !== clientId)) return null;
      const contributions = state.contributions
        .filter((contribution) => contribution.catalogId === catalogId)
        .map((contribution) => this.contributionView(catalog, contribution, userId));
      return this.paginate(contributions, query);
    });
  }

  async getCatalogContribution(
    clientId: string,
    userId: string | undefined,
    catalogId: string,
    contributionId: string,
  ): Promise<CatalogContributionView | null> {
    return await this.read((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const contribution = state.contributions.find(
        (item) => item.id === contributionId && item.catalogId === catalogId,
      );
      if (!catalog || !contribution) return null;
      const canSee = catalog.visibility === "public"
        || catalog.ownerClientId === clientId
        || contribution.contributorUserId === userId;
      return canSee ? this.contributionView(catalog, contribution, userId) : null;
    });
  }

  async mergeContribution(
    clientId: string,
    author: CatalogAuthor,
    catalogId: string,
    contributionId: string,
    input: ResolveCatalogContributionInput,
  ): Promise<ContributionMutationResult> {
    return await this.mutate((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const contribution = state.contributions.find(
        (item) => item.id === contributionId && item.catalogId === catalogId,
      );
      if (!catalog || !contribution || contribution.status !== "open") return { kind: "not-found" };
      if (catalog.authorUserId !== author.userId || catalog.ownerClientId !== clientId) return { kind: "forbidden" };
      if (!this.collaborationEnabled(state, catalog)) return { kind: "disabled" };
      if (input.expectedHeadRevisionId && input.expectedHeadRevisionId !== catalog.headRevisionId) {
        return { kind: "stale", headRevisionId: catalog.headRevisionId };
      }
      const validated = validateContributionMerge(catalog.words, contribution.changes);
      if (!validated.changes.length) return { kind: "empty" };
      const ownerClient = this.client(state, clientId);
      const source = ownerClient.wordbooks.find(
        (book) => book.id === catalog.sourceWordbookId && !book.deletedAt,
      );
      if (!source) return { kind: "disabled" };
      const conflicts = [
        ...validated.conflicts,
        ...this.sourceConflicts(source, catalog.words, validated.changes),
      ];
      if (conflicts.length) return { kind: "conflict", conflicts };

      const at = this.now().toISOString();
      catalog.words = applyCatalogChanges(catalog.words, validated.changes);
      this.applyChangesToSource(ownerClient, source, validated.changes, at);
      const revision: CatalogRevision = {
        id: `revision-${randomUUID()}`,
        catalogId,
        parentRevisionId: catalog.headRevisionId,
        kind: "merge",
        message: contribution.title,
        ...(contribution.contributorUserId ? { authorUserId: contribution.contributorUserId } : {}),
        author: contribution.contributor,
        committerUserId: author.userId,
        committer: author.username,
        createdAt: at,
        changes: clone(validated.changes),
        stats: catalogDiffStats(validated.changes),
        contributionId: contribution.id,
      };
      state.revisions.push(revision);
      catalog.headRevisionId = revision.id;
      catalog.updatedAt = at;
      contribution.status = "merged";
      contribution.updatedAt = at;
      contribution.handledAt = at;
      contribution.handledByUserId = author.userId;
      contribution.handledBy = author.username;
      contribution.mergedRevisionId = revision.id;
      if (input.resolutionNote) contribution.resolutionNote = input.resolutionNote;
      return {
        kind: "updated",
        contribution: this.contributionView(catalog, contribution, author.userId),
      };
    });
  }

  async closeContribution(
    clientId: string,
    author: CatalogAuthor,
    catalogId: string,
    contributionId: string,
    input: ResolveCatalogContributionInput,
  ): Promise<ContributionMutationResult> {
    return await this.mutate((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const contribution = state.contributions.find(
        (item) => item.id === contributionId && item.catalogId === catalogId,
      );
      if (!catalog || !contribution || contribution.status !== "open") return { kind: "not-found" };
      const owner = catalog.authorUserId === author.userId && catalog.ownerClientId === clientId;
      const contributor = contribution.contributorUserId === author.userId;
      if (!owner && !contributor) return { kind: "forbidden" };
      const at = this.now().toISOString();
      contribution.status = "closed";
      contribution.updatedAt = at;
      contribution.handledAt = at;
      contribution.handledByUserId = author.userId;
      contribution.handledBy = author.username;
      if (input.resolutionNote) contribution.resolutionNote = input.resolutionNote;
      return {
        kind: "updated",
        contribution: this.contributionView(catalog, contribution, author.userId),
      };
    });
  }

  async listCatalogRevisions(
    clientId: string,
    userId: string | undefined,
    catalogId: string,
    query: CursorQuery,
  ): Promise<CursorPage<CatalogRevisionView> | null> {
    return await this.read((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      if (!catalog || !visibleTo(catalog, clientId)) return null;
      const revisions = state.revisions
        .filter((revision) => revision.catalogId === catalogId)
        .map((revision) => this.revisionView(state, catalog, revision, userId));
      return this.paginate(revisions, query);
    });
  }

  async getCatalogRevision(
    clientId: string,
    userId: string | undefined,
    catalogId: string,
    revisionId: string,
  ): Promise<CatalogRevisionView | null> {
    return await this.read((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const revision = state.revisions.find(
        (item) => item.id === revisionId && item.catalogId === catalogId,
      );
      if (!catalog || !revision || !visibleTo(catalog, clientId)) return null;
      return this.revisionView(state, catalog, revision, userId);
    });
  }

  async getRevertPreview(
    clientId: string,
    userId: string,
    catalogId: string,
    revisionId: string,
  ): Promise<RevertPreview | null> {
    return await this.read((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const target = state.revisions.find(
        (revision) => revision.id === revisionId && revision.catalogId === catalogId,
      );
      if (!catalog || !target || catalog.authorUserId !== userId || catalog.ownerClientId !== clientId) return null;
      if (!this.collaborationEnabled(state, catalog)) return null;
      return this.revertPreview(state, catalog, target);
    });
  }

  async revertRevision(
    clientId: string,
    author: CatalogAuthor,
    catalogId: string,
    revisionId: string,
    input: RevertRevisionInput,
  ): Promise<RevisionMutationResult> {
    return await this.mutate((state) => {
      const catalog = state.catalog.find((book) => book.id === catalogId);
      const target = state.revisions.find(
        (revision) => revision.id === revisionId && revision.catalogId === catalogId,
      );
      if (!catalog || !target) return { kind: "not-found" };
      if (catalog.authorUserId !== author.userId || catalog.ownerClientId !== clientId) return { kind: "forbidden" };
      if (!this.collaborationEnabled(state, catalog)) return { kind: "disabled" };
      if (input.expectedHeadRevisionId !== catalog.headRevisionId) {
        return { kind: "stale", headRevisionId: catalog.headRevisionId };
      }
      const preview = this.revertPreview(state, catalog, target);
      if (preview.conflicts.length) return { kind: "conflict", conflicts: preview.conflicts };
      if (preview.alreadyReverted || !preview.changes.length) return { kind: "already-reverted" };
      const ownerClient = this.client(state, clientId);
      const source = ownerClient.wordbooks.find(
        (book) => book.id === catalog.sourceWordbookId && !book.deletedAt,
      );
      if (!source) return { kind: "disabled" };
      const at = this.now().toISOString();
      catalog.words = applyCatalogChanges(catalog.words, preview.changes);
      this.applyChangesToSource(ownerClient, source, preview.changes, at);
      const revision: CatalogRevision = {
        id: `revision-${randomUUID()}`,
        catalogId,
        parentRevisionId: catalog.headRevisionId,
        kind: "revert",
        message: input.message ?? `回滚 ${target.id.slice(-8)}`,
        authorUserId: author.userId,
        author: author.username,
        committerUserId: author.userId,
        committer: author.username,
        createdAt: at,
        changes: clone(preview.changes),
        stats: catalogDiffStats(preview.changes),
        revertsRevisionId: target.id,
      };
      state.revisions.push(revision);
      catalog.headRevisionId = revision.id;
      catalog.updatedAt = at;
      return { kind: "updated", revision: this.revisionView(state, catalog, revision, author.userId) };
    });
  }

  async listAccountContributions(
    clientId: string,
    userId: string,
    scope: "review" | "authored",
    query: CursorQuery,
  ): Promise<CursorPage<CatalogContributionView> & { openCount: number }> {
    return await this.read((state) => {
      const contributions = state.contributions.filter((contribution) => {
        const catalog = state.catalog.find((book) => book.id === contribution.catalogId);
        return catalog && (scope === "review"
          ? catalog.authorUserId === userId && catalog.ownerClientId === clientId
          : contribution.contributorUserId === userId);
      });
      const openCount = contributions.filter((contribution) => contribution.status === "open").length;
      const views = contributions.map((contribution) => {
        const catalog = state.catalog.find((book) => book.id === contribution.catalogId)!;
        return this.contributionView(catalog, contribution, userId);
      });
      return { ...this.paginate(views, query), openCount };
    });
  }

  // --- Private collection ---
  async getStudySettings(clientId: string): Promise<SyncedStudySettings | null> {
    return await this.read((state) => {
      const settings = this.clientView(state, clientId).studySettings;
      return settings ? clone(settings) : null;
    });
  }
  async updateStudySettings(clientId: string, input: UpdateStudySettingsInput): Promise<SyncedStudySettings> {
    return await this.mutate((state) => {
      const client = this.client(state, clientId);
      const current = client.studySettings ?? {
        shortcuts: {
          unknown: "q",
          vague: "w",
          pronounce: "enter",
          known: "e",
          flip: " ",
          dictationPronounce: "tab",
        },
        pronunciation: { accent: "gb" as const },
        updatedAt: this.now().toISOString(),
      };
      const settings: SyncedStudySettings = {
        shortcuts: clone(input.shortcuts ?? current.shortcuts),
        pronunciation: clone(input.pronunciation ?? current.pronunciation),
        updatedAt: this.now().toISOString(),
      };
      client.studySettings = settings;
      return clone(settings);
    });
  }
  async listMyWordbooks(clientId: string, trash: boolean): Promise<MyWordbookCard[]> { return await this.read((state) => { const client = this.clientView(state, clientId); return client.wordbooks.filter((book) => Boolean(book.deletedAt) === trash).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((book) => card(book, client.events)); }); }
  async createMyWordbook(clientId: string, input: CreateMyWordbookInput): Promise<MyWordbookCard> { return await this.mutate((state) => {
    const at = this.now().toISOString(); const client = this.client(state, clientId);
    const book: MyWordbook = { id: `my-${randomUUID()}`, title: input.title, description: input.description ?? "", ...(input.category ? { category: input.category } : {}), createdAt: at, updatedAt: at, words: toWordbookWords(input.words ?? [], at) };
    client.wordbooks.push(book); return card(book, client.events);
  }); }
  async updateMyWordbook(clientId: string, id: string, input: UpdateMyWordbookInput): Promise<MyWordbookCard | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt);
    if (!book) return null;
    if (Object.hasOwn(input, "category")) {
      if (input.category === null) delete book.category; else book.category = input.category;
    }
    if (input.reviewSchedule) book.reviewSchedule = clone(input.reviewSchedule);
    if (input.studyPreferences) book.studyPreferences = clone(input.studyPreferences);
    book.updatedAt = this.now().toISOString();
    return card(book, client.events);
  }); }
  async getMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.read((state) => { const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); return book ? card(book, client.events) : null; }); }
  async deleteMyWordbook(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return false; const at = this.now().toISOString(); book.deletedAt = at; book.updatedAt = at; client.studyRounds = client.studyRounds.filter((round) => round.wordbookId !== id); return true; }); }
  async restoreMyWordbook(clientId: string, id: string): Promise<MyWordbookCard | null> { return await this.mutate((state) => { const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === id && item.deletedAt); if (!book) return null; book.deletedAt = undefined; book.updatedAt = this.now().toISOString(); return card(book, client.events); }); }
  async listWords(clientId: string, id: string, status?: WordLearningStatus): Promise<LearningQueueItem[] | null> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null;
    const states = ladderStates(client.events.filter((event) => event.wordbookId === id), reviewScheduleOf(book));
    return book.words.map((word) => queueItem(word, ladderOf(states, word.id))).filter((word) => !status || word.status === status);
  }); }
  async findPersonalWord(clientId: string, word: string): Promise<StudyWordEntry | null> { return await this.read((state) => {
    const normalized = normalizeWord(word);
    const books = this.clientView(state, clientId).wordbooks
      .filter((book) => !book.deletedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const book of books) {
      const found = book.words.find((entry) => entry.word === normalized);
      if (found && (found.meanings.length > 0 || Boolean(found.zhMeaning))) {
        const { id: _id, addedAt: _addedAt, ...entry } = found;
        return clone(entry);
      }
    }
    return null;
  }); }
  async addWordToMyWordbook(clientId: string, wordbookId: string, entry: StudyWordEntry): Promise<{ word: LearningQueueItem; created: boolean } | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === wordbookId && !item.deletedAt); if (!book) return null;
    // Words are stored normalized; dedupe on an exact normalized match.
    const states = ladderStates(client.events.filter((event) => event.wordbookId === wordbookId), reviewScheduleOf(book));
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
    client.wordbooks.splice(index, 1); client.events = client.events.filter((event) => event.wordbookId !== id); client.studyRounds = client.studyRounds.filter((round) => round.wordbookId !== id); return true;
  }); }
  async deleteCatalogUpload(clientId: string, id: string): Promise<boolean> { return await this.mutate((state) => {
    const index = state.catalog.findIndex((book) => book.id === id && book.ownerClientId === clientId);
    if (index < 0) return false;
    state.catalog.splice(index, 1);
    state.revisions = state.revisions.filter((revision) => revision.catalogId !== id);
    state.contributions = state.contributions.filter((contribution) => contribution.catalogId !== id);
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
    const ladderState = ladderOf(ladderStates(client.events.filter((event) => event.wordbookId === wordbookId), reviewScheduleOf(book)), target.id);
    return { kind: "updated", word: studiedWord(target, ladderState) };
  }); }
  async batchWords(clientId: string, wordbookId: string, input: BatchWordInput): Promise<BatchWordResult | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId);
    const book = client.wordbooks.find((item) => item.id === wordbookId && !item.deletedAt);
    if (!book) return null;
    const succeededIds: string[] = [];
    const failed: BatchWordResult["failed"] = [];
    const requested = new Set(input.wordIds);
    const existingIds = new Set(book.words.filter((word) => requested.has(word.id)).map((word) => word.id));
    for (const wordId of input.wordIds) if (!existingIds.has(wordId)) failed.push({ wordId, code: "WORD_NOT_FOUND" });

    if (input.action === "delete") {
      book.words = book.words.filter((word) => {
        if (!existingIds.has(word.id)) return true;
        succeededIds.push(word.id);
        return false;
      });
      client.events = client.events.filter((event) => event.wordbookId !== wordbookId || !existingIds.has(event.wordId));
      if (succeededIds.length) client.studyRounds = client.studyRounds.filter((round) => round.wordbookId !== wordbookId);
    } else if (input.action === "mark-mastered") {
      const at = this.now().toISOString();
      for (const word of book.words) {
        if (!existingIds.has(word.id)) continue;
        client.events.push({
          kind: "mark", wordbookId, word: word.word, wordId: word.id,
          level: 4, id: randomUUID(), occurredAt: at,
        });
        succeededIds.push(word.id);
      }
    } else {
      for (const word of book.words) {
        if (!existingIds.has(word.id)) continue;
        const rematched = input.rematched?.[word.id];
        if (!rematched) {
          failed.push({ wordId: word.id, code: "DICTIONARY_UNAVAILABLE" });
          continue;
        }
        const customChinese = word.zhMeaningSource === "user";
        word.phonetic = rematched.phonetic;
        word.meanings = clone(rematched.meanings);
        word.source = rematched.source;
        if (rematched.audioUrl) word.audioUrl = rematched.audioUrl; else delete word.audioUrl;
        if (!customChinese) {
          if (rematched.zhMeaning) {
            word.zhMeaning = rematched.zhMeaning;
            word.zhMeaningSource = rematched.zhMeaningSource;
          } else {
            delete word.zhMeaning;
            delete word.zhMeaningSource;
          }
        }
        succeededIds.push(word.id);
      }
    }
    if (succeededIds.length) book.updatedAt = this.now().toISOString();
    return { action: input.action, succeededIds, failed };
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
      const entry: ImportDraftEntry = {
        id: randomUUID(), line: line.line, ...(normalized ? { word: normalized } : {}),
        ...(line.phonetic ? { phonetic: line.phonetic } : {}), ...(line.pos ? { pos: line.pos } : {}), ...(line.enDefinition ? { enDefinition: line.enDefinition } : {}),
        ...(line.zhMeaning ? { zhMeaning: line.zhMeaning } : {}), ...(line.example ? { example: line.example } : {}),
        ...(line.meanings !== undefined ? { meanings: clone(line.meanings) } : {}),
        status: "processing",
      };
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
    if ((input.mode ?? "append") === "overwrite") {
      if (!draft.targetWordbookId || !book) return null;
      const siblings = client.drafts.filter((item) => item.groupId === draft.groupId);
      if (siblings.length !== draft.totalBatches || siblings.some((item) => item.status === "processing")) return null;
      const previousByWord = new Map(book.words.map((word) => [word.word, word]));
      const replacement: WordbookWord[] = [];
      for (const sibling of siblings.sort((left, right) => left.batchIndex - right.batchIndex)) {
        for (const item of sibling.entries) {
          if (!item.word || !item.entry || (item.status !== "ready" && item.status !== "unmatched" && item.status !== "conflict")) continue;
          const resolution = input.resolutions?.[item.id] ?? "replace";
          item.resolution = resolution;
          if (resolution === "discard") continue;
          const previous = previousByWord.get(item.word);
          replacement.push(previous
            ? { ...clone(item.entry), id: previous.id, addedAt: previous.addedAt }
            : { ...clone(item.entry), id: randomUUID(), addedAt: at });
        }
      }
      const liveIds = new Set(replacement.map((word) => word.id));
      book.words = replacement;
      client.events = client.events.filter((event) => event.wordbookId !== book!.id || liveIds.has(event.wordId));
      client.studyRounds = client.studyRounds.filter((round) => round.wordbookId !== book!.id);
      book.updatedAt = at;
      for (const sibling of siblings) {
        sibling.status = "committed";
        sibling.committedAt = at;
        sibling.updatedAt = at;
      }
    } else if (draft.status !== "committed") {
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
  async startStudyRound(clientId: string, input: StartStudyRoundInput): Promise<{ round: StudyRound; resumed: boolean } | null> {
    return await this.mutate((state) => {
      const client = this.client(state, clientId);
      const book = client.wordbooks.find((item) => item.id === input.wordbookId && !item.deletedAt);
      if (!book) return null;
      const now = this.now();
      const nowMs = now.getTime();
      const expiresAt = new Date(nowMs + STUDY_ROUND_TTL_MS).toISOString();
      client.studyRounds = client.studyRounds
        .filter((round) => Date.parse(round.expiresAt) > nowMs && client.wordbooks.some((item) => item.id === round.wordbookId && !item.deletedAt))
        .slice(-MAX_STUDY_ROUNDS_PER_CLIENT + 1);
      const scope = input.scope ?? "standard";
      const existing = client.studyRounds.find(
        (round) => round.wordbookId === book.id
          && round.mode === input.mode
          && round.scope === scope
          && !round.completedAt
          && round.queue.length > 0,
      );
      if (existing) {
        existing.updatedAt = now.toISOString();
        existing.expiresAt = expiresAt;
        return { round: clone(existing), resumed: true };
      }

      const preferences = preferencesOf(book);
      const modePreferences = preferences.modes[input.mode];
      const events = client.events.filter((event) => event.wordbookId === book.id);
      const schedule = reviewScheduleOf(book);
      const states = ladderStates(events, schedule);
      let selected: WordbookWord[] = [];
      if (input.mode === "new") {
        const afterById = ladderEventLevels(events, schedule);
        const today = day(now);
        const completedToday = new Set(
          events
            .filter((event) => event.kind === "new" && day(new Date(event.occurredAt)) === today && afterById.get(event.id) === 1)
            .map((event) => event.wordId),
        ).size;
        const unstudied = book.words.filter((word) => ladderOf(states, word.id).level === 0);
        if (scope === "ahead") {
          const batchSize = Math.min(200, Math.max(1, preferences.plan.newWords));
          selected = unstudied.slice(0, batchSize);
        } else {
          const remaining = Math.max(0, preferences.plan.newWords - completedToday);
          selected = unstudied.slice(0, remaining);
        }
      } else {
        if (scope === "ahead") {
          selected = book.words
            .filter((word) => {
              const wordState = ladderOf(states, word.id);
              return wordState.level > 0 && !reviewDue(wordState, now, schedule);
            })
            .sort((left, right) => dueTimestamp(ladderOf(states, left.id)) - dueTimestamp(ladderOf(states, right.id)))
            .slice(0, 200);
        }
        const lanes: Record<"protected" | "regular" | "backlog", WordbookWord[]> = {
          protected: [],
          regular: [],
          backlog: [],
        };
        for (const word of book.words) {
          const lane = reviewLane(ladderOf(states, word.id), now, schedule);
          if (lane) lanes[lane].push(word);
        }
        lanes.protected.sort((left, right) => {
          const a = ladderOf(states, left.id);
          const b = ladderOf(states, right.id);
          return Number(b.relearning) - Number(a.relearning) || dueTimestamp(a) - dueTimestamp(b);
        });
        lanes.regular.sort((left, right) => dueTimestamp(ladderOf(states, left.id)) - dueTimestamp(ladderOf(states, right.id)));
        lanes.backlog.sort((left, right) => dueTimestamp(ladderOf(states, left.id)) - dueTimestamp(ladderOf(states, right.id)));
        const completed = completedReviewLanes(events, schedule, day(now));
        if (scope === "ahead") {
          // The voluntary ahead deck was selected above and does not consume today's backlog cap.
        } else if (scope === "backlog") {
          const batchSize = Math.min(200, Math.max(50, preferences.plan.backlogReviews));
          selected = lanes.backlog.slice(0, batchSize);
        } else {
          const remainingBacklog = Math.max(0, preferences.plan.backlogReviews - completed.backlog.size);
          selected = [...lanes.protected, ...lanes.regular, ...lanes.backlog.slice(0, remainingBacklog)];
        }
      }

      const wordIds = selected.map((word) => word.id);
      const at = now.toISOString();
      const queue = buildRoundTasks(wordIds, modePreferences.exerciseTypes);
      const round: StudyRound = {
        id: randomUUID(),
        wordbookId: book.id,
        mode: input.mode,
        scope,
        meaningPreference: modePreferences.meaningPreference,
        exerciseTypes: clone(modePreferences.exerciseTypes),
        wordIds,
        queue,
        passedTaskKeys: [],
        completedWordIds: [],
        vagueWordIds: [],
        unknownWordIds: [],
        processedOperationIds: [],
        revision: 0,
        createdAt: at,
        updatedAt: at,
        expiresAt,
        ...(queue.length === 0 ? { completedAt: at } : {}),
      };
      client.studyRounds.push(round);
      return { round: clone(round), resumed: false };
    });
  }
  async getStudyRound(clientId: string, id: string): Promise<StudyRound | null> {
    return await this.read((state) => {
      const client = this.clientView(state, clientId);
      const round = client.studyRounds.find((item) => item.id === id && Date.parse(item.expiresAt) > this.now().getTime());
      if (!round || !client.wordbooks.some((book) => book.id === round.wordbookId && !book.deletedAt)) return null;
      return clone(round);
    });
  }
  async getStudyRoundTaskOptions(
    clientId: string,
    id: string,
    taskId: string,
    meaningPreference?: MeaningPreference,
  ): Promise<StudyRoundTaskOptions | null> {
    return await this.read((state) => {
      const client = this.clientView(state, clientId);
      const round = client.studyRounds.find((item) => item.id === id && Date.parse(item.expiresAt) > this.now().getTime());
      const task = round?.queue[0];
      const book = round ? client.wordbooks.find((item) => item.id === round.wordbookId && !item.deletedAt) : undefined;
      const target = book?.words.find((word) => word.id === task?.wordId);
      if (!round || !task || task.id !== taskId || task.exercise !== "meaning-choice" || !book || !target) return null;

      const asOption = (entry: StudyWordEntry, wordId: string): StudyChoiceOption | null => {
        const first = entry.meanings.find((meaning) => meaning.definition.trim()) ?? entry.meanings[0];
        const englishDefinition = first?.definition.trim();
        const chineseDefinition = entry.zhMeaning?.trim();
        const definition = (meaningPreference ?? round.meaningPreference) === "zh"
          ? chineseDefinition || englishDefinition
          : englishDefinition || chineseDefinition;
        if (!definition) return null;
        return { wordId, word: entry.word, pos: first?.pos ?? "", definition };
      };
      const correct = asOption(target, target.id);
      if (!correct) return { taskId: task.id, wordId: target.id, options: [] };

      const pool = new Map<string, { entry: StudyWordEntry; wordId: string; local: boolean }>();
      for (const candidateBook of client.wordbooks.filter((item) => !item.deletedAt)) {
        for (const candidate of candidateBook.words) {
          if (!pool.has(candidate.word)) pool.set(candidate.word, { entry: candidate, wordId: candidate.id, local: candidateBook.id === book.id });
        }
      }
      state.catalog.forEach((catalogBook) => catalogBook.words.forEach((candidate, index) => {
        if (!pool.has(candidate.word)) {
          pool.set(candidate.word, { entry: candidate, wordId: `catalog-${catalogBook.id}-${index}`, local: false });
        }
      }));
      pool.delete(target.word);

      const definitions = new Set([correct.definition.trim().toLocaleLowerCase()]);
      const ranked = [...pool.values()]
        .map((candidate) => ({ candidate, option: asOption(candidate.entry, candidate.wordId) }))
        .filter((item): item is { candidate: { entry: StudyWordEntry; wordId: string; local: boolean }; option: StudyChoiceOption } => {
          if (!item.option) return false;
          const key = item.option.definition.trim().toLocaleLowerCase();
          if (definitions.has(key)) return false;
          definitions.add(key);
          return true;
        })
        .map((item) => ({
          ...item,
          score: lexicalSimilarity(target.word, item.candidate.entry.word) + (item.candidate.local ? 4 : 0),
        }))
        .sort((left, right) => right.score - left.score || left.option.word.localeCompare(right.option.word))
        .slice(0, 3)
        .map((item) => item.option);
      const options = [correct, ...ranked].sort(
        (left, right) => stableHash(`${task.id}:${left.word}`) - stableHash(`${task.id}:${right.word}`),
      );
      return { taskId: task.id, wordId: target.id, options };
    });
  }
  async rotateStudyRound(clientId: string, id: string, revision: number): Promise<StudyRoundMutationResult> {
    return await this.mutate((state) => {
      const round = this.client(state, clientId).studyRounds.find((item) => item.id === id);
      if (!round || round.completedAt || Date.parse(round.expiresAt) <= this.now().getTime() || round.queue.length === 0) return { kind: "not-found" };
      if (round.revision !== revision) return { kind: "conflict", round: clone(round) };
      const firstWordId = round.queue[0]!.wordId;
      const moved = round.queue.filter((task) => task.wordId === firstWordId);
      round.queue = [...round.queue.filter((task) => task.wordId !== firstWordId), ...moved];
      round.revision += 1;
      round.updatedAt = this.now().toISOString();
      round.expiresAt = new Date(this.now().getTime() + STUDY_ROUND_TTL_MS).toISOString();
      return { kind: "updated", round: clone(round) };
    });
  }
  async answerStudyRound(clientId: string, id: string, input: StudyRoundAnswerInput): Promise<StudyRoundMutationResult> {
    return await this.mutate((state) => {
      const client = this.client(state, clientId);
      const round = client.studyRounds.find((item) => item.id === id);
      if (!round || round.completedAt || Date.parse(round.expiresAt) <= this.now().getTime()) return { kind: "not-found" };
      if (round.processedOperationIds.includes(input.operationId)) return { kind: "updated", round: clone(round) };
      if (round.revision !== input.revision || round.queue[0]?.id !== input.taskId) return { kind: "conflict", round: clone(round) };
      const task = round.queue[0]!;
      const responseMatches = task.exercise === "self-rating"
        ? input.response === "know" || input.response === "vague" || input.response === "unknown"
        : input.response === "correct" || input.response === "incorrect";
      if (!responseMatches) return { kind: "conflict", round: clone(round) };
      const book = client.wordbooks.find((item) => item.id === round.wordbookId && !item.deletedAt);
      const target = book?.words.find((word) => word.id === task.wordId);
      if (!book || !target) return { kind: "not-found" };

      const passed = input.response === "know" || input.response === "correct";
      round.queue.shift();
      if (passed) {
        const key = roundTaskKey(task);
        if (!round.passedTaskKeys.includes(key)) round.passedTaskKeys.push(key);
      } else {
        const verdict = input.response === "vague" ? "vague" : "unknown";
        this.appendLearningEvent(
          client,
          book,
          target,
          round.mode === "new"
            ? { kind: "new", wordbookId: book.id, wordId: target.id, verdict }
            : { kind: "flashcard", wordbookId: book.id, wordId: target.id, verdict },
        );
        const collection = verdict === "vague" ? round.vagueWordIds : round.unknownWordIds;
        if (!collection.includes(target.id)) collection.push(target.id);
        round.queue.push({ ...task, id: randomUUID() });
      }

      const completed = round.exerciseTypes.every((exercise) =>
        round.passedTaskKeys.includes(roundTaskKey({ wordId: target.id, exercise })),
      );
      if (completed && !round.completedWordIds.includes(target.id)) {
        this.appendLearningEvent(
          client,
          book,
          target,
          round.mode === "new"
            ? { kind: "new", wordbookId: book.id, wordId: target.id, verdict: "know" }
            : { kind: "flashcard", wordbookId: book.id, wordId: target.id, verdict: "know" },
        );
        round.completedWordIds.push(target.id);
      }

      round.processedOperationIds.push(input.operationId);
      if (round.processedOperationIds.length > MAX_PROCESSED_ROUND_OPERATIONS) {
        round.processedOperationIds.splice(0, round.processedOperationIds.length - MAX_PROCESSED_ROUND_OPERATIONS);
      }
      const now = this.now();
      round.revision += 1;
      round.updatedAt = now.toISOString();
      round.expiresAt = new Date(now.getTime() + STUDY_ROUND_TTL_MS).toISOString();
      if (round.queue.length === 0) round.completedAt = round.updatedAt;
      return { kind: "updated", round: clone(round) };
    });
  }
  async recordEvent(clientId: string, input: LearningEventInput): Promise<LearningEvent | null> { return await this.mutate((state) => {
    const client = this.client(state, clientId); const book = client.wordbooks.find((item) => item.id === input.wordbookId && !item.deletedAt);
    const target = input.wordId ? book?.words.find((word) => word.id === input.wordId) : book?.words.find((word) => word.word === input.word);
    if (!book || !target) return null;
    return this.appendLearningEvent(client, book, target, input);
  }); }
  async getDashboard(clientId: string, id: string): Promise<StudyDashboard | null> { return await this.read((state) => {
    const client = this.clientView(state, clientId); const book = client.wordbooks.find((item) => item.id === id && !item.deletedAt); if (!book) return null;
    const now = this.now(); const today = day(now); const events = client.events.filter((event) => event.wordbookId === id);
    const schedule = reviewScheduleOf(book);
    const activityEvents = events.filter((event) => event.kind !== "mark" || event.retainedState === undefined);
    // Manual marks are not study effort: excluded from calendar/streak/week and completed tallies,
    // but still surfaced in recentActivity. Internal retention checkpoints stay invisible.
    const studyEvents = activityEvents.filter((event) => event.kind !== "mark");
    const todayEvents = studyEvents.filter((event) => day(new Date(event.occurredAt)) === today);
    const afterById = ladderEventLevels(events, schedule);
    const uniqueWords = (items: LearningEvent[], kind?: LearningEvent["kind"]) =>
      new Set(items.filter((event) => !kind || event.kind === kind).map((event) => event.wordId));
    // Count the first judgment that actually crosses L0 -> L1 so daily progress stays word-based.
    const completedNew = uniqueWords(todayEvents.filter((event) => event.kind === "new" && afterById.get(event.id) === 1)).size;
    // The lane is captured at a word's first attempt today. A fuzzy/incorrect attempt can move
    // its next due time, but the later successful retry still completes the originally due item.
    const completedLanes = completedReviewLanes(events, schedule, today);
    const completedReviewIds = new Set([
      ...completedLanes.protected,
      ...completedLanes.regular,
      ...completedLanes.backlog,
    ]);
    const completedReview = completedReviewIds.size;
    const completedDictation = uniqueWords(todayEvents.filter((event) => event.kind === "dictation" && event.correct)).size;
    const states = ladderStates(events, schedule); const bookProgress = progress(book, events); const { levels } = bookProgress;
    // Availability per contract: 新词学习 from l0, 听写训练 from l2+l3+l4; 复习巩固 is the adaptive DUE count (below).
    const newAvailable = levels.l0; const dictationAvailable = levels.l2 + levels.l3 + levels.l4;
    // Every learned rung stays on the expanding review schedule. finalCheckDue is the L3 subset
    // currently due; a successful dictation at a mature interval can promote it to L4.
    const reviewBreakdown = { protected: 0, regular: 0, backlog: 0, scheduled: 0 };
    let finalCheckDue = 0;
    for (const word of book.words) {
      const s = ladderOf(states, word.id);
      const lane = reviewLane(s, now, schedule);
      if (lane) reviewBreakdown[lane] += 1;
      if (s.level === 3 && reviewDue(s, now, schedule)) finalCheckDue += 1;
    }
    const preferences = preferencesOf(book);
    const remainingBacklog = Math.max(0, preferences.plan.backlogReviews - completedLanes.backlog.size);
    reviewBreakdown.scheduled = reviewBreakdown.protected
      + reviewBreakdown.regular
      + Math.min(reviewBreakdown.backlog, remainingBacklog);
    const activeRounds = client.studyRounds
      .filter((round) => round.wordbookId === book.id && !round.completedAt && round.queue.length > 0 && Date.parse(round.expiresAt) > now.getTime())
      .map((round) => ({
        id: round.id,
        mode: round.mode,
        scope: round.scope,
        remainingWords: new Set(round.queue.map((task) => task.wordId)).size,
        updatedAt: round.updatedAt,
      }));
    const perDay = new Map<string, Set<string>>();
    for (const event of studyEvents) {
      const key = day(new Date(event.occurredAt)); const words = perDay.get(key) ?? new Set<string>();
      words.add(event.wordId); perDay.set(key, words);
    }
    const calendar = Array.from({ length: 7 }, (_, index) => { const date = day(shiftDay(now, index - 6)); const amount = perDay.get(date)?.size ?? 0; return { date, count: amount, active: amount > 0 }; });
    let streak = 0; for (let offset = 0; offset < 365; offset += 1) { if (!(perDay.get(day(shiftDay(now, -offset)))?.size)) break; streak += 1; }
    // Same 7 calendar days as the calendar block so both widgets always agree.
    const weekDays = new Set(calendar.map((item) => item.date));
    const weekEvents = studyEvents.filter((event) => weekDays.has(day(new Date(event.occurredAt))));
    const weekNewIds = uniqueWords(weekEvents.filter((event) => event.kind === "new" && afterById.get(event.id) === 1));
    const weekReviewIds = uniqueWords(weekEvents, "flashcard"); const weekDictationIds = uniqueWords(weekEvents.filter((event) => event.kind === "dictation" && event.correct));
    const weekTotalIds = new Set([...weekNewIds, ...weekReviewIds, ...weekDictationIds]);
    const weekNew = weekNewIds.size; const weekReview = weekReviewIds.size; const weekDictation = weekDictationIds.size;
    // The 结果 column shows the proficiency a word held right after each study action.
    // Reverse first so equal-millisecond events retain newest-insertion-first
    // ordering under JavaScript's stable sort.
    return {
      wordbook: card(book, events),
      todayPlan: {
        new: {
          target: Math.max(completedNew, Math.min(preferences.plan.newWords, completedNew + newAvailable)),
          completed: completedNew,
        },
        review: { target: completedReview + reviewBreakdown.scheduled, completed: completedReview },
        dictation: {
          target: Math.max(completedDictation, Math.min(preferences.plan.dictation, completedDictation + dictationAvailable)),
          completed: completedDictation,
        },
      },
      recentActivity: clone([...activityEvents].reverse().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5))
        .map((event) => ({ ...event, levelAfter: afterById.get(event.id) ?? 0 as WordLevel })),
      calendar,
      week: { newCount: weekNew, reviewCount: weekReview, dictationCount: weekDictation, total: weekTotalIds.size },
      streakDays: streak,
      reviewBreakdown,
      activeRounds,
      finalCheckDue,
      updatedAt: book.updatedAt,
    };
  }); }

  // --- Shared state plumbing ---
  private collaborationEnabled(state: State, catalog: CatalogWordbook): boolean {
    if (
      catalog.visibility !== "public"
      || !catalog.authorUserId
      || !catalog.ownerClientId
      || !catalog.sourceWordbookId
      || !state.users.some((user) => user.id === catalog.authorUserId)
    ) return false;
    const owner = state.clients[catalog.ownerClientId];
    return Boolean(owner?.wordbooks.some(
      (wordbook) => wordbook.id === catalog.sourceWordbookId && !wordbook.deletedAt,
    ));
  }

  private revisionSummary(revision: CatalogRevision | undefined): CatalogRevisionSummary | undefined {
    if (!revision) return undefined;
    return {
      id: revision.id,
      kind: revision.kind,
      message: revision.message,
      author: revision.author,
      ...(revision.committer ? { committer: revision.committer } : {}),
      createdAt: revision.createdAt,
      stats: clone(revision.stats),
      ...(revision.contributionId ? { contributionId: revision.contributionId } : {}),
      ...(revision.revertsRevisionId ? { revertsRevisionId: revision.revertsRevisionId } : {}),
    };
  }

  private catalogCard(state: State, book: CatalogWordbook, client: ClientData, clientId: string): CatalogCard {
    return buildCatalogCard(book, client, clientId, this.favoriteCount(state, book.id), {
      enabled: this.collaborationEnabled(state, book),
      openContributionCount: state.contributions.filter(
        (contribution) => contribution.catalogId === book.id && contribution.status === "open",
      ).length,
      latestRevision: this.revisionSummary(
        state.revisions.find((revision) => revision.id === book.headRevisionId),
      ),
    });
  }

  private contributionPreview(
    state: State,
    clientId: string,
    userId: string,
    wordbookId: string,
  ): { kind: "ready"; preview: ContributionPreview } | { kind: "not-found" | "disabled" } {
    if (!state.users.some((user) => user.id === userId)) return { kind: "not-found" };
    const source = this.clientView(state, clientId).wordbooks.find(
      (wordbook) => wordbook.id === wordbookId && !wordbook.deletedAt,
    );
    if (!source?.sourceCatalogId) return { kind: "not-found" };
    const catalog = state.catalog.find((book) => book.id === source.sourceCatalogId);
    if (!catalog) return { kind: "not-found" };
    if (!this.collaborationEnabled(state, catalog)) return { kind: "disabled" };
    const revisions = state.revisions.filter((revision) => revision.catalogId === catalog.id);
    const knownBaseline = source.sourceRevisionId
      ? revisions.find((revision) => revision.id === source.sourceRevisionId)
      : undefined;
    const baseRevisionId = knownBaseline?.id ?? catalog.headRevisionId;
    const baseline = catalogAtRevision(revisions, baseRevisionId);
    if (!baseline) return { kind: "not-found" };
    const threeWay = threeWayContribution(baseline, toCatalogWords(source.words), catalog.words);
    return {
      kind: "ready",
      preview: {
        catalogId: catalog.id,
        catalogTitle: catalog.title,
        sourceWordbookId: source.id,
        baseRevisionId,
        headRevisionId: catalog.headRevisionId,
        expectedSourceUpdatedAt: source.updatedAt,
        expectedHeadRevisionId: catalog.headRevisionId,
        legacyBaseline: !knownBaseline,
        changes: threeWay.changes,
        stats: catalogDiffStats(threeWay.changes),
        overlaps: threeWay.overlaps,
      },
    };
  }

  private contributionView(
    catalog: CatalogWordbook,
    contribution: CatalogContribution,
    userId: string | undefined,
  ): CatalogContributionView {
    const owner = catalog.authorUserId === userId;
    const changes = meaningfulCatalogChanges(contribution.changes);
    return {
      ...clone(contribution),
      changes: clone(changes),
      stats: catalogDiffStats(changes),
      catalogTitle: catalog.title,
      canMerge: contribution.status === "open" && owner,
      canClose: contribution.status === "open"
        && (owner || contribution.contributorUserId === userId),
    };
  }

  private revisionView(
    state: State,
    catalog: CatalogWordbook,
    revision: CatalogRevision,
    userId: string | undefined,
  ): CatalogRevisionView {
    const changes = meaningfulCatalogChanges(revision.changes);
    return {
      ...clone(revision),
      changes: clone(changes),
      stats: catalogDiffStats(changes),
      catalogTitle: catalog.title,
      canRevert: catalog.authorUserId === userId && this.collaborationEnabled(state, catalog),
    };
  }

  private sourceConflicts(
    source: MyWordbook,
    publicWords: StudyWordEntry[],
    changes: CatalogWordChange[],
  ): CatalogConflict[] {
    const publicByKey = new Map(publicWords.map((word) => [normalizeWord(word.word), word]));
    const sourceByKey = new Map(toCatalogWords(source.words).map((word) => [normalizeWord(word.word), word]));
    const conflicts: CatalogConflict[] = [];
    for (const change of changes) {
      const expected = publicByKey.get(change.key);
      const current = sourceByKey.get(change.key);
      if (sameCatalogWord(expected, current)) continue;
      conflicts.push({
        key: change.key,
        reason: "source-diverged",
        ...(expected ? { base: clone(expected) } : {}),
        ...(current ? { current: clone(current) } : {}),
        ...(change.kind === "delete" ? {} : { proposed: clone(change.after) }),
      });
    }
    return conflicts;
  }

  private applyChangesToSource(
    client: ClientData,
    source: MyWordbook,
    changes: CatalogWordChange[],
    at: string,
  ): void {
    const deletedWordIds = new Set<string>();
    for (const change of changes) {
      const index = source.words.findIndex((word) => normalizeWord(word.word) === change.key);
      if (change.kind === "delete") {
        if (index >= 0) {
          const [deleted] = source.words.splice(index, 1);
          if (deleted) deletedWordIds.add(deleted.id);
        }
      } else if (index >= 0) {
        const retained = source.words[index]!;
        source.words[index] = {
          ...clone(change.after),
          id: retained.id,
          addedAt: retained.addedAt,
        };
      } else {
        source.words.push({
          ...clone(change.after),
          id: randomUUID(),
          addedAt: at,
        });
      }
    }
    if (deletedWordIds.size) {
      client.events = client.events.filter(
        (event) => event.wordbookId !== source.id || !deletedWordIds.has(event.wordId),
      );
      client.studyRounds = client.studyRounds.filter((round) => round.wordbookId !== source.id);
    }
    source.updatedAt = at;
  }

  private revertPreview(state: State, catalog: CatalogWordbook, target: CatalogRevision): RevertPreview {
    const inverse = inverseRevisionAgainstHead(target, catalog.words);
    const owner = catalog.ownerClientId ? state.clients[catalog.ownerClientId] : undefined;
    const source = owner?.wordbooks.find(
      (wordbook) => wordbook.id === catalog.sourceWordbookId && !wordbook.deletedAt,
    );
    const sourceConflicts = source ? this.sourceConflicts(source, catalog.words, inverse.changes) : [];
    const conflicts = [...inverse.conflicts, ...sourceConflicts];
    return {
      catalogId: catalog.id,
      revisionId: target.id,
      headRevisionId: catalog.headRevisionId,
      changes: clone(inverse.changes),
      stats: catalogDiffStats(inverse.changes),
      conflicts,
      alreadyReverted: inverse.alreadyReverted && conflicts.length === 0,
    };
  }

  private paginate<T extends { id: string; createdAt: string }>(items: T[], query: CursorQuery): CursorPage<T> {
    const ordered = [...items].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
    let start = 0;
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
        if (typeof decoded.createdAt === "string" && typeof decoded.id === "string") {
          const index = ordered.findIndex(
            (item) => item.createdAt === decoded.createdAt && item.id === decoded.id,
          );
          if (index >= 0) start = index + 1;
        }
      } catch {
        start = 0;
      }
    }
    const limit = Math.max(1, Math.min(50, query.limit ?? 20));
    const page = ordered.slice(start, start + limit);
    const last = page.at(-1);
    const nextCursor = last && start + page.length < ordered.length
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id }), "utf8").toString("base64url")
      : undefined;
    return { items: clone(page), ...(nextCursor ? { nextCursor } : {}) };
  }

  private client(state: State, id: string): ClientData {
    if (!Object.hasOwn(state.clients, id)) state.clients[id] = defaultClient();
    return state.clients[id]!;
  }
  /** Read-only view: never inserts a client record, so GETs cannot grow the persisted state. */
  private clientView(state: State, id: string): ClientData {
    return Object.hasOwn(state.clients, id) ? state.clients[id]! : defaultClient();
  }
  private appendLearningEvent(
    client: ClientData,
    book: MyWordbook,
    target: WordbookWord,
    input: LearningEventInput,
  ): LearningEvent {
    const now = this.now();
    client.events = compactLearningEvents(
      client.events,
      now.getTime() - RETENTION_MS,
      (wordbookId) => reviewScheduleOf(client.wordbooks.find((candidate) => candidate.id === wordbookId) ?? {}),
    );
    const common = {
      wordbookId: book.id,
      word: target.word,
      wordId: target.id,
      id: randomUUID(),
      occurredAt: now.toISOString(),
    };
    const event: LearningEvent = input.kind === "new"
      ? { ...common, kind: "new", ...(input.verdict ? { verdict: input.verdict } : {}) }
      : input.kind === "flashcard"
        ? { ...common, kind: "flashcard", verdict: input.verdict }
        : input.kind === "dictation"
          ? { ...common, kind: "dictation", correct: input.correct }
          : { ...common, kind: "mark", level: input.level };
    client.events.push(event);
    book.updatedAt = event.occurredAt;
    return event;
  }
  private favoriteCount(state: State, catalogId: string): number {
    let total = 0;
    for (const client of Object.values(state.clients)) if (client.favorites.includes(catalogId)) total += 1;
    return total;
  }
  private recordAdoption(book: CatalogWordbook, clientId: string): void {
    const adopters = new Set(book.adopterClientIds ?? []);
    if (adopters.has(clientId)) return;
    adopters.add(clientId);
    book.adopterClientIds = [...adopters];
    book.uses = (book.legacyUses ?? 0) + adopters.size;
  }
  private upsertSeedSource(client: ClientData, id: string, title: string, description: string, words: StudyWordEntry[], at: string): MyWordbook {
    let source = client.wordbooks.find((book) => book.id === id);
    if (!source) {
      source = { id, title, description, createdAt: at, updatedAt: at, words: toWordbookWords(words, at) };
      client.wordbooks.push(source);
      return source;
    }
    const existing = new Map(source.words.map((word) => [word.word, word]));
    source.title = title;
    source.description = description;
    source.deletedAt = undefined;
    source.words = words.map((word) => {
      const retained = existing.get(word.word);
      return retained ? { ...clone(word), id: retained.id, addedAt: retained.addedAt } : { ...clone(word), id: randomUUID(), addedAt: at };
    });
    const liveWordIds = new Set(source.words.map((word) => word.id));
    client.events = client.events.filter((event) => event.wordbookId !== source.id || liveWordIds.has(event.wordId));
    source.updatedAt = at;
    return source;
  }
  /** 12 hexadecimal characters = 48 bits; legacy 6–8 character codes remain importable. */
  private shareCode(state: State): string { let code = ""; do { code = randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase(); } while (state.catalog.some((book) => book.shareCode === code)); return code; }
  private async read<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => {
    await this.refreshBeforeOperation();
    return operation(await this.state());
  }); this.queue = task.then(() => undefined, () => undefined); return await task; }
  private async mutate<T>(operation: (state: State) => T): Promise<T> { const task = this.queue.then(async () => {
    await this.refreshBeforeOperation();
    const previous = await this.state();
    const draft = clone(previous);
    const value = operation(draft);
    this.enforceResourceLimits(previous, draft);
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
  private enforceResourceLimits(previous: State, next: State): void {
    const clientIds = new Set([...Object.keys(previous.clients), ...Object.keys(next.clients)]);
    const usage = (state: State, clientId: string) => {
      const client = Object.hasOwn(state.clients, clientId) ? state.clients[clientId]! : defaultClient();
      return {
        wordbooks: client.wordbooks.length,
        words: client.wordbooks.reduce((total, book) => total + book.words.length, 0),
        drafts: client.drafts.length,
      };
    };
    for (const clientId of clientIds) {
      const before = usage(previous, clientId);
      const after = usage(next, clientId);
      if (after.wordbooks > this.limits.maxWordbooksPerClient && after.wordbooks > before.wordbooks) {
        throw new StudyResourceLimitError("wordbooks");
      }
      if (after.words > this.limits.maxWordsPerClient && after.words > before.words) {
        throw new StudyResourceLimitError("words");
      }
      if (after.drafts > this.limits.maxDraftsPerClient && after.drafts > before.drafts) {
        throw new StudyResourceLimitError("drafts");
      }
    }
  }
}
export class InMemoryStudyStore extends BaseStore {
  constructor(options: { now?: () => Date; limits?: StudyResourceLimits } = {}) { super(options.now, options.limits); }
  protected async load(): Promise<State> { return EMPTY(); }
  protected async save(_state: State, _previous?: State): Promise<void> {}
}
export class JsonFileStudyStore extends BaseStore {
  private readonly filePath: string;
  constructor(filePath: string, options: { now?: () => Date; limits?: StudyResourceLimits } = {}) { super(options.now, options.limits); this.filePath = resolve(filePath); }
  protected async load(): Promise<State> { try { return migrate(JSON.parse(await readFile(this.filePath, "utf8")) as unknown); } catch (error) { if (isJsonObject(error) && error.code === "ENOENT") return EMPTY(); throw error; } }
  protected async save(state: State, _previous?: State): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temp, this.filePath); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
}
