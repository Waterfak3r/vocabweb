import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeWord } from "../words/normalize.js";
import { isJsonObject, parseStudyEvent, parseStudyWordEntry } from "./validation.js";
import type {
  AddWordResult,
  StudyEvent,
  StudyEventInput,
  StudyStore,
  StudySummary,
  StudyWordEntry,
  WordbookItem,
} from "./types.js";

interface ClientStudyData {
  wordbook: WordbookItem[];
  events: StudyEvent[];
  updatedAt: string;
}

interface PersistedStudyData {
  version: 1;
  clients: Record<string, ClientStudyData>;
}

const EMPTY_STATE = (): PersistedStudyData => ({ version: 1, clients: {} });
const EVENT_RETENTION_DAYS = 90;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertStoredClient(value: unknown): ClientStudyData {
  if (!isJsonObject(value) || !Array.isArray(value.wordbook) || !Array.isArray(value.events)) {
    throw new Error("Study data file has an invalid client record");
  }
  if (!isValidIsoDate(value.updatedAt)) {
    throw new Error("Study data file has an invalid update timestamp");
  }

  const wordbook = value.wordbook.map((item) => {
    const entry = parseStudyWordEntry(item);
    if (!entry || !isJsonObject(item) || item.id !== entry.word || !isValidIsoDate(item.addedAt)) {
      throw new Error("Study data file has an invalid wordbook item");
    }
    return { ...entry, id: entry.word, addedAt: item.addedAt };
  });

  const seenWords = new Set<string>();
  for (const item of wordbook) {
    if (seenWords.has(item.id)) {
      throw new Error("Study data file contains duplicate wordbook items");
    }
    seenWords.add(item.id);
  }

  const events = value.events.map((event) => {
    const input = parseStudyEvent(event);
    if (!input || !isJsonObject(event) || typeof event.id !== "string" || !event.id || !isValidIsoDate(event.occurredAt)) {
      throw new Error("Study data file has an invalid activity event");
    }
    return { ...input, id: event.id, occurredAt: event.occurredAt } as StudyEvent;
  });

  return { wordbook, events, updatedAt: value.updatedAt };
}

function parsePersistedData(value: unknown): PersistedStudyData {
  if (!isJsonObject(value) || value.version !== 1 || !isJsonObject(value.clients)) {
    throw new Error("Study data file has an unsupported format");
  }

  const clients: Record<string, ClientStudyData> = {};
  for (const [clientId, client] of Object.entries(value.clients)) {
    clients[clientId] = assertStoredClient(client);
  }

  return { version: 1, clients };
}

abstract class BaseStudyStore implements StudyStore {
  private statePromise: Promise<PersistedStudyData> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  protected constructor(private readonly now: () => Date = () => new Date()) {}

  protected abstract load(): Promise<PersistedStudyData>;
  protected abstract save(state: PersistedStudyData): Promise<void>;

  async getSummary(clientId: string, dailyGoal: number): Promise<StudySummary> {
    return await this.read((state) => {
      const now = this.now();
      const date = localDateKey(now);
      const client = state.clients[clientId];
      const wordbook = client?.wordbook ?? [];
      const todayEvents = (client?.events ?? []).filter(
        (event) => localDateKey(new Date(event.occurredAt)) === date,
      );
      const addedToday = wordbook.filter(
        (item) => localDateKey(new Date(item.addedAt)) === date,
      ).length;
      const lookupCount = todayEvents.filter((event) => event.kind === "lookup").length;
      const reviewEvents = todayEvents.filter((event) => event.kind === "flashcard");
      const dictationEvents = todayEvents.filter((event) => event.kind === "dictation");
      const reviewedWords = new Set(reviewEvents.map((event) => event.word));
      const dictatedWords = new Set(dictationEvents.map((event) => event.word));

      return {
        date,
        wordbookTotal: wordbook.length,
        addedToday,
        lookupCount,
        review: {
          due: wordbook.filter((item) => !reviewedWords.has(item.word)).length,
          completedToday: reviewEvents.length,
        },
        dictation: {
          due: wordbook.filter((item) => !dictatedWords.has(item.word)).length,
          completedToday: dictationEvents.length,
        },
        dailyGoal: {
          target: dailyGoal,
          completed: addedToday + reviewEvents.length + dictationEvents.length,
        },
        updatedAt: client?.updatedAt ?? null,
      };
    });
  }

  async listWordbook(clientId: string): Promise<WordbookItem[]> {
    return await this.read((state) => {
      const items = state.clients[clientId]?.wordbook ?? [];
      return clone([...items].sort((left, right) => right.addedAt.localeCompare(left.addedAt)));
    });
  }

  async addWord(clientId: string, entry: StudyWordEntry): Promise<AddWordResult> {
    return await this.mutate((state) => {
      const now = this.now().toISOString();
      const client = this.clientForWrite(state, clientId, now);
      const existing = client.wordbook.find((item) => item.id === entry.word);
      if (existing) {
        return { item: clone(existing), created: false };
      }

      const item: WordbookItem = { ...clone(entry), id: entry.word, addedAt: now };
      client.wordbook.push(item);
      client.updatedAt = now;
      return { item: clone(item), created: true };
    });
  }

  async removeWord(clientId: string, word: string): Promise<boolean> {
    return await this.mutate((state) => {
      const current = state.clients[clientId];
      if (!current) {
        return false;
      }

      const index = current.wordbook.findIndex((item) => item.id === word);
      if (index < 0) {
        return false;
      }

      current.wordbook.splice(index, 1);
      current.updatedAt = this.now().toISOString();
      return true;
    });
  }

  async recordEvent(clientId: string, input: StudyEventInput): Promise<StudyEvent> {
    return await this.mutate((state) => {
      const now = this.now();
      const occurredAt = now.toISOString();
      const client = this.clientForWrite(state, clientId, occurredAt);
      this.pruneEvents(client, now);

      const event: StudyEvent = { ...clone(input), id: randomUUID(), occurredAt };
      client.events.push(event);
      client.updatedAt = occurredAt;
      return clone(event);
    });
  }

  private clientForWrite(
    state: PersistedStudyData,
    clientId: string,
    now: string,
  ): ClientStudyData {
    const existing = state.clients[clientId];
    if (existing) {
      return existing;
    }

    const client: ClientStudyData = { wordbook: [], events: [], updatedAt: now };
    state.clients[clientId] = client;
    return client;
  }

  private pruneEvents(client: ClientStudyData, now: Date): void {
    const cutoff = now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
    client.events = client.events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
  }

  private async read<T>(operation: (state: PersistedStudyData) => T): Promise<T> {
    await this.writeQueue;
    return operation(await this.getState());
  }

  private async mutate<T>(operation: (state: PersistedStudyData) => T): Promise<T> {
    const task = this.writeQueue.then(async () => {
      const state = await this.getState();
      const result = operation(state);
      await this.save(state);
      return result;
    });
    this.writeQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  }

  private async getState(): Promise<PersistedStudyData> {
    this.statePromise ??= this.load();
    return await this.statePromise;
  }
}

export interface InMemoryStudyStoreOptions {
  now?: () => Date;
}

/** Test and embedding implementation: it deliberately does not survive restarts. */
export class InMemoryStudyStore extends BaseStudyStore {
  constructor(options: InMemoryStudyStoreOptions = {}) {
    super(options.now);
  }

  protected async load(): Promise<PersistedStudyData> {
    return EMPTY_STATE();
  }

  protected async save(_state: PersistedStudyData): Promise<void> {}
}

export interface JsonFileStudyStoreOptions {
  now?: () => Date;
}

/**
 * Production implementation. Every mutation is serialized and committed by an
 * atomic same-directory rename, so an interrupted write cannot leave partial JSON.
 */
export class JsonFileStudyStore extends BaseStudyStore {
  private readonly filePath: string;

  constructor(filePath: string, options: JsonFileStudyStoreOptions = {}) {
    super(options.now);
    this.filePath = resolve(filePath);
  }

  protected async load(): Promise<PersistedStudyData> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return parsePersistedData(JSON.parse(content) as unknown);
    } catch (error) {
      if (isJsonObject(error) && error.code === "ENOENT") {
        return EMPTY_STATE();
      }
      throw error;
    }
  }

  protected async save(state: PersistedStudyData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function normalizeWordbookId(raw: string): string {
  return normalizeWord(raw);
}
