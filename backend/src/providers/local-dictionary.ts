import { resolve } from "node:path";
import Database from "better-sqlite3";
import { normalizeWord } from "../words/normalize.js";
import type { WordEntry, WordMeaning, WordProvider } from "../words/types.js";

type EntryRow = { lemma: string; phonetic: string; zh_meaning: string | null };
type MeaningRow = { pos: string; definition: string; example: string | null; source_id?: string };
type SuggestionRow = { lemma: string; zh_meaning: string | null };

export type WordSuggestion = {
  word: string;
  zhMeaning?: string;
  kind: "word" | "phrase";
};

export interface WordSuggestionLookup {
  suggest(query: string, limit: number): Promise<WordSuggestion[]>;
}

const POS: Record<string, string> = {
  n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb",
};

export class SqliteLocalDictionaryProvider implements WordProvider, WordSuggestionLookup {
  private database?: Database.Database;

  constructor(private readonly databaseFile: string) {}

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  checkHealth(): void {
    const db = this.open();
    if (!db) throw new Error("Local dictionary database is unavailable");
    if (!db.prepare("SELECT 1 AS ready FROM dictionary_entries LIMIT 1").get()) {
      throw new Error("Local dictionary database is empty");
    }
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const db = this.open();
    if (!db) return null;
    const lemma = normalizeWord(word);
    const entry = db.prepare("SELECT lemma, phonetic, zh_meaning FROM dictionary_entries WHERE lemma = ?").get(lemma) as EntryRow | undefined;
    if (!entry) return null;
    const hasSourceId = db.prepare("PRAGMA table_info(dictionary_meanings)").all()
      .some((column) => (column as { name?: string }).name === "source_id");
    const rows = db.prepare(`
      SELECT pos, definition, example${hasSourceId ? ", source_id" : ""}
      FROM dictionary_meanings
      WHERE lemma = ?
      ORDER BY sort_order
      LIMIT 8
    `).all(lemma) as MeaningRow[];
    const meanings: WordMeaning[] = rows.map((row) => ({
      pos: POS[row.pos] ?? row.pos,
      definition: row.definition,
      ...(row.example ? { example: row.example } : {}),
      ...(row.source_id === "wiktionary"
        ? { sourceId: "wiktionary" as const }
        : { sourceId: "open_english_wordnet" as const }),
    }));
    const availableLanguages: Array<"zh" | "en"> = [];
    if (entry.zh_meaning) availableLanguages.push("zh");
    if (meanings.length) availableLanguages.push("en");
    if (!availableLanguages.length) return null;
    const wiktionaryVersion = rows.some((row) => row.source_id === "wiktionary")
      ? (db.prepare("SELECT value FROM dictionary_metadata WHERE key = 'wiktextract_dump_date'").get() as { value?: string } | undefined)?.value
      : undefined;
    return {
      word: entry.lemma,
      phonetic: entry.phonetic ? `/${entry.phonetic.replace(/^[/\[]/, "").replace(/[/\]]$/, "")}/` : "",
      meanings,
      ...(entry.zh_meaning ? { zhMeaning: entry.zh_meaning, zhMeaningSource: "dictionary" as const } : {}),
      availableLanguages,
      sources: [
        ...(rows.some((row) => !row.source_id || row.source_id === "open_english_wordnet") ? [{
          id: "open_english_wordnet" as const,
          name: "Open English WordNet",
          version: "2025",
          license: "CC BY 4.0",
          url: "https://en-word.net/",
        }] : []),
        ...(rows.some((row) => row.source_id === "wiktionary") ? [{
          id: "wiktionary" as const,
          name: "English Wiktionary",
          version: wiktionaryVersion && wiktionaryVersion !== "not-imported"
            ? `Kaikki ${wiktionaryVersion}`
            : "offline extract",
          license: "CC BY-SA 4.0 / GFDL",
          url: `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.lemma.replaceAll(" ", "_"))}`,
        }] : []),
        ...(entry.zh_meaning ? [{
          id: "ecdict" as const,
          name: "ECDICT",
          version: "bc015ed2",
          license: "MIT（仓库声明）",
          url: "https://github.com/skywind3000/ECDICT",
        }] : []),
      ],
      source: "backend",
    };
  }

  async lookupChinese(word: string): Promise<string | undefined> {
    return (await this.lookup(word))?.zhMeaning;
  }

  async suggest(rawQuery: string, limit: number): Promise<WordSuggestion[]> {
    const db = this.open();
    if (!db) return [];
    const query = rawQuery.trim().replace(/\s+/g, " ");
    if (isChineseSuggestionQuery(query)) {
      const rows = db.prepare(`
        SELECT lemma, zh_meaning
        FROM dictionary_entries
        WHERE zh_meaning IS NOT NULL AND instr(zh_meaning, ?) > 0
        ORDER BY
          CASE WHEN trim(zh_meaning) = ? THEN 0 ELSE 1 END,
          CASE WHEN instr(trim(zh_meaning), ?) = 1 THEN 0 ELSE 1 END,
          CASE WHEN frq IS NULL THEN 1 ELSE 0 END,
          frq,
          length(lemma),
          lemma
        LIMIT ?
      `).all(query, query, query, limit) as SuggestionRow[];
      return rows.map(toSuggestion);
    }
    const normalizedQuery = normalizeWord(query);
    const upperBound = `${normalizedQuery}\uffff`;
    const prefixRows = db.prepare(`
      SELECT lemma, zh_meaning
      FROM dictionary_entries
      WHERE lemma >= ? AND lemma < ?
      ORDER BY
        CASE WHEN lemma = ? THEN 0 ELSE 1 END,
        CASE WHEN frq IS NULL THEN 1 ELSE 0 END,
        frq,
        CASE WHEN bnc IS NULL THEN 1 ELSE 0 END,
        bnc,
        length(lemma),
        lemma
      LIMIT ?
    `).all(normalizedQuery, upperBound, normalizedQuery, limit) as SuggestionRow[];

    const remaining = limit - prefixRows.length;
    const containsRows = remaining > 0
      ? db.prepare(`
          SELECT lemma, zh_meaning
          FROM dictionary_entries
          WHERE instr(lemma, ?) > 0
            AND NOT (lemma >= ? AND lemma < ?)
          ORDER BY
            CASE WHEN frq IS NULL THEN 1 ELSE 0 END,
            frq,
            CASE WHEN bnc IS NULL THEN 1 ELSE 0 END,
            bnc,
            length(lemma),
            lemma
          LIMIT ?
        `).all(normalizedQuery, normalizedQuery, upperBound, remaining) as SuggestionRow[]
      : [];

    return [...prefixRows, ...containsRows].map(toSuggestion);
  }

  private open(): Database.Database | undefined {
    if (this.database?.open) return this.database;
    try {
      this.database = new Database(resolve(this.databaseFile), { readonly: true, fileMustExist: true });
      this.database.pragma("query_only = ON");
      return this.database;
    } catch {
      return undefined;
    }
  }
}

export function isChineseSuggestionQuery(value: string): boolean {
  return value.length >= 2 && value.length <= 24 && /^[\p{Script=Han}\s]+$/u.test(value);
}

function toSuggestion(row: SuggestionRow): WordSuggestion {
  return {
    word: row.lemma,
    kind: row.lemma.includes(" ") ? "phrase" : "word",
    ...(row.zh_meaning ? { zhMeaning: summarizeChineseMeaning(row.zh_meaning) } : {}),
  };
}

function summarizeChineseMeaning(value: string): string {
  const summary = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ") ?? "";
  const characters = Array.from(summary);
  return characters.length > 60
    ? `${characters.slice(0, 60).join("")}…`
    : summary;
}
