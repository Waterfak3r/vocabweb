import { resolve } from "node:path";
import Database from "better-sqlite3";
import { normalizeWord } from "../words/normalize.js";
import type { WordEntry, WordMeaning, WordProvider } from "../words/types.js";

type EntryRow = { lemma: string; phonetic: string; zh_meaning: string | null };
type MeaningRow = { pos: string; definition: string; example: string | null };

const POS: Record<string, string> = {
  n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb",
};

export class SqliteLocalDictionaryProvider implements WordProvider {
  private database?: Database.Database;

  constructor(private readonly databaseFile: string) {}

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const db = this.open();
    if (!db) return null;
    const lemma = normalizeWord(word);
    const entry = db.prepare("SELECT lemma, phonetic, zh_meaning FROM dictionary_entries WHERE lemma = ?").get(lemma) as EntryRow | undefined;
    if (!entry) return null;
    const rows = db.prepare(`
      SELECT pos, definition, example
      FROM dictionary_meanings
      WHERE lemma = ?
      ORDER BY sort_order
      LIMIT 8
    `).all(lemma) as MeaningRow[];
    const meanings: WordMeaning[] = rows.map((row) => ({
      pos: POS[row.pos] ?? row.pos,
      definition: row.definition,
      ...(row.example ? { example: row.example } : {}),
    }));
    const availableLanguages: Array<"zh" | "en"> = [];
    if (entry.zh_meaning) availableLanguages.push("zh");
    if (meanings.length) availableLanguages.push("en");
    if (!availableLanguages.length) return null;
    return {
      word: entry.lemma,
      phonetic: entry.phonetic ? `/${entry.phonetic.replace(/^[/\[]/, "").replace(/[/\]]$/, "")}/` : "",
      meanings,
      ...(entry.zh_meaning ? { zhMeaning: entry.zh_meaning, zhMeaningSource: "dictionary" as const } : {}),
      availableLanguages,
      sources: [
        ...(meanings.length ? [{
          id: "open_english_wordnet" as const,
          name: "Open English WordNet",
          version: "2025",
          license: "CC BY 4.0",
          url: "https://en-word.net/",
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
