import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type PopularSearch = { word: string; count: number };
export type FeedbackType = "suggestion" | "bug" | "other";
export type FeedbackInput = {
  type: FeedbackType;
  message: string;
  contact?: string;
  page?: string;
};

export interface EngagementStore {
  recordSearch(word: string): Promise<void>;
  listPopularSearches(since: Date, limit: number): Promise<PopularSearch[]>;
  createFeedback(input: FeedbackInput): Promise<{ id: string; createdAt: string }>;
}

type SearchEvent = { word: string; searchedAt: string };
type FeedbackRecord = FeedbackInput & { id: string; createdAt: string };

export class MemoryEngagementStore implements EngagementStore {
  readonly searches: SearchEvent[] = [];
  readonly feedback: FeedbackRecord[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async recordSearch(word: string): Promise<void> {
    this.searches.push({ word, searchedAt: this.now().toISOString() });
  }

  async listPopularSearches(since: Date, limit: number): Promise<PopularSearch[]> {
    const counts = new Map<string, number>();
    for (const event of this.searches) {
      if (Date.parse(event.searchedAt) >= since.getTime()) {
        counts.set(event.word, (counts.get(event.word) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
      .slice(0, limit);
  }

  async createFeedback(input: FeedbackInput): Promise<{ id: string; createdAt: string }> {
    const record = { ...structuredClone(input), id: randomUUID(), createdAt: this.now().toISOString() };
    this.feedback.push(record);
    return { id: record.id, createdAt: record.createdAt };
  }
}

export class SqliteEngagementStore implements EngagementStore {
  private database?: Database.Database;

  constructor(
    private readonly databaseFile: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  async recordSearch(word: string): Promise<void> {
    const db = await this.open();
    const searchedAt = this.now().toISOString();
    const retentionCutoff = new Date(this.now().getTime() - 30 * 86_400_000).toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO search_events(word, searched_at) VALUES (?, ?)").run(word, searchedAt);
      db.prepare("DELETE FROM search_events WHERE searched_at < ?").run(retentionCutoff);
    })();
  }

  async listPopularSearches(since: Date, limit: number): Promise<PopularSearch[]> {
    const db = await this.open();
    return db.prepare(`
      SELECT word, COUNT(*) AS count
      FROM search_events
      WHERE searched_at >= ?
      GROUP BY word
      ORDER BY count DESC, word ASC
      LIMIT ?
    `).all(since.toISOString(), limit) as PopularSearch[];
  }

  async createFeedback(input: FeedbackInput): Promise<{ id: string; createdAt: string }> {
    const db = await this.open();
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    db.prepare(`
      INSERT INTO feedback(id, type, message, contact, page, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.type, input.message, input.contact ?? null, input.page ?? null, createdAt);
    return { id, createdAt };
  }

  private async open(): Promise<Database.Database> {
    if (this.database?.open) return this.database;
    const databaseFile = resolve(this.databaseFile);
    await mkdir(dirname(databaseFile), { recursive: true });
    const db = new Database(databaseFile);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL,
        searched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS search_events_time_word_idx
        ON search_events(searched_at, word);
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('suggestion', 'bug', 'other')),
        message TEXT NOT NULL,
        contact TEXT,
        page TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS feedback_created_at_idx
        ON feedback(created_at DESC);
    `);
    this.database = db;
    return db;
  }
}
