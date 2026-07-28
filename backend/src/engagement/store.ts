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
export type MessageActor = {
  clientId: string;
  userId?: string;
  username?: string;
  isAdmin?: boolean;
};
export type MessageDto = {
  id: string;
  parentId?: string;
  rootId: string;
  depth: 0 | 1 | 2;
  author: string;
  replyTo?: string;
  contact?: string;
  content?: string;
  status: "active" | "deleted" | "hidden";
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
};
export type MessagePage = { items: MessageDto[]; nextCursor?: string };

export interface EngagementStore {
  getSiteSetting(key: string): Promise<string | null>;
  setSiteSetting(key: string, value: string | null): Promise<void>;
  recordSearch(word: string): Promise<void>;
  listPopularSearches(since: Date, limit: number): Promise<PopularSearch[]>;
  createFeedback(input: FeedbackInput): Promise<{ id: string; createdAt: string }>;
  listMessages(actor: MessageActor | null, cursor: string | undefined, limit: number): Promise<MessagePage>;
  createMessage(actor: MessageActor, input: { content: string; nickname?: string; contact?: string; parentId?: string }): Promise<MessageDto | null>;
  editMessage(actor: MessageActor, id: string, content: string): Promise<MessageDto | "forbidden" | null>;
  softDeleteMessage(actor: MessageActor, id: string): Promise<"deleted" | "forbidden" | "not-found">;
  moderateMessage(id: string, action: "hide" | "restore"): Promise<boolean>;
  permanentlyDeleteMessage(id: string): Promise<boolean>;
  unreadMessageCount(userId: string): Promise<number>;
  markMessagesRead(userId: string): Promise<void>;
  exportUserData(userId: string): Promise<unknown>;
  deleteUserData(userId: string): Promise<void>;
}

type SearchEvent = { word: string; searchedAt: string };
type FeedbackRecord = FeedbackInput & { id: string; createdAt: string };

export class MemoryEngagementStore implements EngagementStore {
  readonly siteSettings = new Map<string, string>();
  readonly searches: SearchEvent[] = [];
  readonly feedback: FeedbackRecord[] = [];
  readonly messages: Array<{
    id: string; parentId?: string; replyToId?: string; rootId: string; depth: 0 | 1 | 2; authorClientId: string;
    authorUserId?: string; author: string; replyTo?: string; contact?: string; content: string; status: "active" | "deleted" | "hidden";
    createdAt: string; updatedAt: string;
  }> = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getSiteSetting(key: string): Promise<string | null> {
    return this.siteSettings.get(key) ?? null;
  }

  async setSiteSetting(key: string, value: string | null): Promise<void> {
    if (value === null) this.siteSettings.delete(key);
    else this.siteSettings.set(key, value);
  }

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
  async listMessages(actor: MessageActor | null, _cursor?: string, _limit?: number): Promise<MessagePage> {
    return { items: this.messages.map((item) => this.dto(item, actor)) };
  }
  async createMessage(actor: MessageActor, input: { content: string; nickname?: string; contact?: string; parentId?: string }): Promise<MessageDto | null> {
    const parent = input.parentId ? this.messages.find((item) => item.id === input.parentId) : undefined;
    if (input.parentId && !parent) return null;
    const id = randomUUID(); const at = this.now().toISOString();
    const depth: 0 | 1 | 2 = parent ? Math.min(2, parent.depth + 1) as 1 | 2 : 0;
    const row = {
      id,
      ...(parent ? { parentId: parent.depth === 2 ? parent.parentId : parent.id } : {}),
      ...(parent ? { replyToId: parent.id } : {}),
      rootId: parent?.rootId ?? id,
      depth,
      authorClientId: actor.clientId,
      ...(actor.userId ? { authorUserId: actor.userId } : {}),
      author: actor.username ?? input.nickname ?? "访客",
      ...(parent ? { replyTo: parent.author } : {}),
      ...(input.contact ? { contact: input.contact } : {}),
      content: input.content,
      status: "active" as const,
      createdAt: at,
      updatedAt: at,
    };
    this.messages.push(row);
    return this.dto(row, actor);
  }
  async editMessage(actor: MessageActor, id: string, content: string): Promise<MessageDto | "forbidden" | null> {
    const item = this.messages.find((message) => message.id === id);
    if (!item) return null;
    if (!this.owns(item, actor) || this.now().getTime() - Date.parse(item.createdAt) > 30 * 60_000 || item.status !== "active") return "forbidden";
    item.content = content; item.updatedAt = this.now().toISOString(); return this.dto(item, actor);
  }
  async softDeleteMessage(actor: MessageActor, id: string): Promise<"deleted" | "forbidden" | "not-found"> {
    const item = this.messages.find((message) => message.id === id);
    if (!item) return "not-found";
    if (!this.owns(item, actor)) return "forbidden";
    item.status = "deleted"; item.content = ""; item.updatedAt = this.now().toISOString(); return "deleted";
  }
  async moderateMessage(id: string, action: "hide" | "restore"): Promise<boolean> {
    const item = this.messages.find((message) => message.id === id); if (!item) return false;
    item.status = action === "hide" ? "hidden" : "active"; item.updatedAt = this.now().toISOString(); return true;
  }
  async permanentlyDeleteMessage(id: string): Promise<boolean> {
    const item = this.messages.find((message) => message.id === id); if (!item) return false;
    const ids = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const message of this.messages) if (message.replyToId && ids.has(message.replyToId) && !ids.has(message.id)) { ids.add(message.id); changed = true; } }
    for (let index = this.messages.length - 1; index >= 0; index -= 1) if (ids.has(this.messages[index]!.id)) this.messages.splice(index, 1);
    return true;
  }
  async unreadMessageCount(): Promise<number> { return 0; }
  async markMessagesRead(): Promise<void> {}
  async exportUserData(userId: string): Promise<unknown> {
    return {
      messages: this.messages
        .filter((message) => message.authorUserId === userId)
        .map(({ id, content, contact, status, createdAt, updatedAt }) => ({ id, content, contact, status, createdAt, updatedAt })),
    };
  }
  async deleteUserData(userId: string): Promise<void> {
    for (const message of this.messages) {
      if (message.authorUserId !== userId) continue;
      message.authorUserId = undefined;
      message.authorClientId = `deleted-${randomUUID()}`;
      message.author = "已注销用户";
      message.contact = undefined;
      message.content = "";
      message.status = "deleted";
      message.updatedAt = this.now().toISOString();
    }
  }
  private owns(item: { authorUserId?: string; authorClientId: string }, actor: MessageActor) { return actor.userId ? item.authorUserId === actor.userId : !item.authorUserId && item.authorClientId === actor.clientId; }
  private dto(item: typeof this.messages[number], actor: MessageActor | null): MessageDto {
    const owns = actor ? this.owns(item, actor) : false;
    return { id: item.id, parentId: item.parentId, rootId: item.rootId, depth: item.depth, author: item.author, replyTo: item.replyTo, ...(actor?.isAdmin && item.contact ? { contact: item.contact } : {}), content: item.status === "active" ? item.content : undefined, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt, edited: item.updatedAt !== item.createdAt, canEdit: owns && item.status === "active" && this.now().getTime() - Date.parse(item.createdAt) <= 30 * 60_000, canDelete: owns };
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

  async getSiteSetting(key: string): Promise<string | null> {
    const db = await this.open();
    const row = db.prepare("SELECT value FROM site_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setSiteSetting(key: string, value: string | null): Promise<void> {
    const db = await this.open();
    if (value === null) {
      db.prepare("DELETE FROM site_settings WHERE key = ?").run(key);
      return;
    }
    db.prepare(`
      INSERT INTO site_settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, this.now().toISOString());
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

  async listMessages(actor: MessageActor | null, cursor: string | undefined, limit: number): Promise<MessagePage> {
    const db = await this.open();
    const decoded = cursor ? this.decodeCursor(cursor) : null;
    const roots = db.prepare(`
      SELECT id, created_at
      FROM messages
      WHERE parent_id IS NULL
        AND (@createdAt IS NULL OR created_at < @createdAt OR (created_at = @createdAt AND id < @id))
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all({ createdAt: decoded?.createdAt ?? null, id: decoded?.id ?? "", limit: limit + 1 }) as Array<{ id: string; created_at: string }>;
    const visibleRoots = roots.slice(0, limit);
    if (!visibleRoots.length) return { items: [] };
    const placeholders = visibleRoots.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT id, parent_id, reply_to_id, root_id, depth, author_client_id, author_user_id, author_name,
             reply_to_name, contact, content, status, created_at, updated_at
      FROM messages
      WHERE root_id IN (${placeholders})
      ORDER BY created_at ASC, rowid ASC
    `).all(...visibleRoots.map((root) => root.id)) as MessageRow[];
    const ordered = visibleRoots.flatMap((root) => rows.filter((row) => row.root_id === root.id));
    const next = roots.length > limit ? visibleRoots.at(-1) : undefined;
    return {
      items: ordered.map((row) => this.messageDto(row, actor)),
      ...(next ? { nextCursor: this.encodeCursor(next.created_at, next.id) } : {}),
    };
  }

  async createMessage(actor: MessageActor, input: { content: string; nickname?: string; contact?: string; parentId?: string }): Promise<MessageDto | null> {
    const db = await this.open();
    const parent = input.parentId ? db.prepare("SELECT * FROM messages WHERE id = ?").get(input.parentId) as MessageRow | undefined : undefined;
    if (input.parentId && !parent) return null;
    const id = randomUUID(); const at = this.now().toISOString();
    const depth = parent ? Math.min(2, parent.depth + 1) as 1 | 2 : 0;
    const parentId = parent ? (parent.depth === 2 ? parent.parent_id : parent.id) : null;
    const rootId = parent?.root_id ?? id;
    const author = actor.username ?? input.nickname ?? "访客";
    const row: MessageRow = {
      id, parent_id: parentId, reply_to_id: parent?.id ?? null, root_id: rootId, depth,
      author_client_id: actor.clientId, author_user_id: actor.userId ?? null,
      author_name: author, reply_to_name: parent?.author_name ?? null, contact: input.contact ?? null,
      content: input.content, status: "active", created_at: at, updated_at: at,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages(id, parent_id, reply_to_id, root_id, depth, author_client_id, author_user_id,
          author_name, reply_to_name, contact, content, status, created_at, updated_at)
        VALUES (@id, @parent_id, @reply_to_id, @root_id, @depth, @author_client_id, @author_user_id,
          @author_name, @reply_to_name, @contact, @content, @status, @created_at, @updated_at)
      `).run(row);
      if (parent?.author_user_id && parent.author_user_id !== actor.userId) {
        db.prepare("INSERT INTO message_notifications(id, user_id, message_id, created_at) VALUES (?, ?, ?, ?)")
          .run(randomUUID(), parent.author_user_id, id, at);
      }
    })();
    return this.messageDto(row, actor);
  }

  async editMessage(actor: MessageActor, id: string, content: string): Promise<MessageDto | "forbidden" | null> {
    const db = await this.open();
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!row) return null;
    if (!this.owns(row, actor) || row.status !== "active" || this.now().getTime() - Date.parse(row.created_at) > 30 * 60_000) return "forbidden";
    const updatedAt = this.now().toISOString();
    db.prepare("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?").run(content, updatedAt, id);
    return this.messageDto({ ...row, content, updated_at: updatedAt }, actor);
  }

  async softDeleteMessage(actor: MessageActor, id: string): Promise<"deleted" | "forbidden" | "not-found"> {
    const db = await this.open();
    const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!row) return "not-found";
    if (!this.owns(row, actor)) return "forbidden";
    db.prepare("UPDATE messages SET status = 'deleted', content = '', updated_at = ? WHERE id = ?").run(this.now().toISOString(), id);
    return "deleted";
  }

  async moderateMessage(id: string, action: "hide" | "restore"): Promise<boolean> {
    const db = await this.open();
    const status = action === "hide" ? "hidden" : "active";
    return db.prepare("UPDATE messages SET status = ?, updated_at = ? WHERE id = ?").run(status, this.now().toISOString(), id).changes > 0;
  }

  async permanentlyDeleteMessage(id: string): Promise<boolean> {
    const db = await this.open();
    return db.transaction(() => {
      const exists = Boolean(db.prepare("SELECT 1 FROM messages WHERE id = ?").get(id));
      if (!exists) return false;
      db.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM messages WHERE id = ?
          UNION ALL
          SELECT messages.id FROM messages JOIN subtree ON messages.reply_to_id = subtree.id
        )
        DELETE FROM messages WHERE id IN (SELECT id FROM subtree)
      `).run(id);
      return true;
    })();
  }

  async unreadMessageCount(userId: string): Promise<number> {
    const db = await this.open();
    return (db.prepare("SELECT COUNT(*) AS count FROM message_notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as { count: number }).count;
  }

  async markMessagesRead(userId: string): Promise<void> {
    const db = await this.open();
    db.prepare("UPDATE message_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(this.now().toISOString(), userId);
  }

  async exportUserData(userId: string): Promise<unknown> {
    const db = await this.open();
    return {
      messages: db.prepare(`
        SELECT id, content, contact, status, created_at AS createdAt, updated_at AS updatedAt
        FROM messages WHERE author_user_id = ? ORDER BY created_at
      `).all(userId),
    };
  }

  async deleteUserData(userId: string): Promise<void> {
    const db = await this.open();
    const at = this.now().toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE messages
        SET author_user_id = NULL,
            author_client_id = 'deleted-' || id,
            author_name = '已注销用户',
            contact = NULL,
            content = '',
            status = 'deleted',
            updated_at = ?
        WHERE author_user_id = ?
      `).run(at, userId);
      db.prepare("DELETE FROM message_notifications WHERE user_id = ?").run(userId);
    })();
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
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        reply_to_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        root_id TEXT NOT NULL,
        depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 2),
        author_client_id TEXT NOT NULL,
        author_user_id TEXT,
        author_name TEXT NOT NULL,
        reply_to_name TEXT,
        contact TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'deleted', 'hidden')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_root_created_idx ON messages(root_id, created_at);
      CREATE INDEX IF NOT EXISTS messages_root_page_idx ON messages(parent_id, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS message_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE INDEX IF NOT EXISTS message_notifications_unread_idx
        ON message_notifications(user_id, read_at, created_at DESC);
    `);
    const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    if (!messageColumns.some((column) => column.name === "contact")) db.exec("ALTER TABLE messages ADD COLUMN contact TEXT");
    db.pragma("foreign_keys = ON");
    this.database = db;
    return db;
  }

  private owns(row: MessageRow, actor: MessageActor): boolean {
    return actor.userId ? row.author_user_id === actor.userId : row.author_user_id === null && row.author_client_id === actor.clientId;
  }

  private messageDto(row: MessageRow, actor: MessageActor | null): MessageDto {
    const owns = actor ? this.owns(row, actor) : false;
    return {
      id: row.id,
      ...(row.parent_id ? { parentId: row.parent_id } : {}),
      rootId: row.root_id,
      depth: row.depth,
      author: row.author_name,
      ...(row.reply_to_name ? { replyTo: row.reply_to_name } : {}),
      ...(actor?.isAdmin && row.contact ? { contact: row.contact } : {}),
      ...(row.status === "active" ? { content: row.content } : {}),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      edited: row.updated_at !== row.created_at,
      canEdit: owns && row.status === "active" && this.now().getTime() - Date.parse(row.created_at) <= 30 * 60_000,
      canDelete: owns,
    };
  }

  private encodeCursor(createdAt: string, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64url");
  }

  private decodeCursor(cursor: string): { createdAt: string; id: string } | null {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
      return value && typeof value === "object" && "createdAt" in value && "id" in value
        && typeof value.createdAt === "string" && typeof value.id === "string"
        ? { createdAt: value.createdAt, id: value.id } : null;
    } catch { return null; }
  }
}

type MessageRow = {
  id: string; parent_id: string | null; reply_to_id: string | null; root_id: string; depth: 0 | 1 | 2;
  author_client_id: string; author_user_id: string | null; author_name: string;
  reply_to_name: string | null; contact: string | null; content: string; status: "active" | "deleted" | "hidden";
  created_at: string; updated_at: string;
};
