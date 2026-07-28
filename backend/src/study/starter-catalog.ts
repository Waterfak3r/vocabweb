import { resolve } from "node:path";
import Database from "better-sqlite3";
import type { SqliteLocalDictionaryProvider } from "../providers/local-dictionary.js";
import type { CatalogExam, StudyStore, StudyWordEntry } from "./types.js";

type StarterDefinition = {
  key: string;
  title: string;
  tag: string;
  exam: CatalogExam;
  excludeTag?: string;
};

const STARTERS: StarterDefinition[] = [
  { key: "v1-cet4-500", title: "大学英语四级·核心 500", tag: "cet4", exam: "四级" },
  { key: "v1-cet6-500", title: "大学英语六级·进阶 500", tag: "cet6", exam: "六级", excludeTag: "cet4" },
  { key: "v1-ky-500", title: "考研英语·高频 500", tag: "ky", exam: "考研" },
  { key: "v1-ielts-500", title: "IELTS·高频 500", tag: "ielts", exam: "IELTS" },
  { key: "v1-toefl-500", title: "TOEFL·高频 500", tag: "toefl", exam: "TOEFL" },
];

export async function ensureStarterCatalog(options: {
  store: StudyStore;
  dictionary: SqliteLocalDictionaryProvider;
  dictionaryFile: string;
  ownerUsername?: string;
  log?: Pick<Console, "info" | "warn">;
}): Promise<{ seeded: number; skipped: boolean }> {
  const ownerUsername = options.ownerUsername ?? "Waterfak3r";
  const log = options.log ?? console;
  const owner = await options.store.getUserByUsername(ownerUsername);
  if (!owner) {
    log.warn(`Starter catalog skipped: account "${ownerUsername}" does not exist.`);
    return { seeded: 0, skipped: true };
  }
  let db: Database.Database;
  try {
    db = new Database(resolve(options.dictionaryFile), { readonly: true, fileMustExist: true });
  } catch {
    log.warn(`Starter catalog skipped: dictionary database is unavailable.`);
    return { seeded: 0, skipped: true };
  }
  const select = db.prepare(`
    SELECT lemma
    FROM dictionary_entries e
    WHERE (' ' || e.tags || ' ') LIKE @tag
      AND (@exclude = '' OR (' ' || e.tags || ' ') NOT LIKE @exclude)
      AND e.zh_meaning IS NOT NULL
      AND EXISTS (SELECT 1 FROM dictionary_meanings m WHERE m.lemma = e.lemma)
    ORDER BY COALESCE(NULLIF(e.bnc, 0), 2147483647),
             COALESCE(NULLIF(e.frq, 0), 2147483647),
             e.lemma
    LIMIT 500
  `);
  try {
    for (const starter of STARTERS) {
      let rows = select.all({
        tag: `% ${starter.tag} %`,
        exclude: starter.excludeTag ? `% ${starter.excludeTag} %` : "",
      }) as Array<{ lemma: string }>;
      if (rows.length < 500 && starter.excludeTag) {
        rows = select.all({ tag: `% ${starter.tag} %`, exclude: "" }) as Array<{ lemma: string }>;
      }
      const words: StudyWordEntry[] = [];
      for (const row of rows) {
        const entry = await options.dictionary.lookup(row.lemma);
        if (entry?.zhMeaning && entry.meanings.length) {
          words.push({
            word: entry.word,
            phonetic: entry.phonetic,
            meanings: entry.meanings,
            zhMeaning: entry.zhMeaning,
            zhMeaningSource: "dictionary",
            source: "backend",
          });
        }
      }
      if (words.length !== 500) throw new Error(`${starter.title} produced ${words.length} words instead of 500`);
      await options.store.upsertSeedCatalog(owner.clientId, {
        seedKey: starter.key,
        author: { userId: owner.id, username: owner.username },
        title: starter.title,
        description: "基于开源词典标签与词频整理的学习精选，非考试机构官方词表。",
        exams: [starter.exam],
        goals: ["阅读"],
        visibility: "public",
        words,
      });
    }
  } finally {
    db.close();
  }
  log.info(`Starter catalog is ready for ${owner.username}.`);
  return { seeded: STARTERS.length, skipped: false };
}
