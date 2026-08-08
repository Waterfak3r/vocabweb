import { createHash } from "node:crypto";
import type { StudyWordEntry } from "./types.js";

/**
 * Content-addressed dictionary identity.
 *
 * Normalized SQLite persistence stores word content once in `dictionary_entries`
 * and references it from `wordbook_words.entry_id`. The entry id is a pure hash
 * of the canonical entry JSON, so identical content always maps to the same id.
 * Account exports reuse the same identity: duplicated word content is shipped once
 * in a `dictionary` section and referenced everywhere else instead of being copied
 * per wordbook.
 */

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalJson(item));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) result[key] = canonicalJson(item);
  }
  return result;
}

export function canonicalEntry(entry: StudyWordEntry): StudyWordEntry {
  // Dictionary providers have historically attached attribution fields beyond the
  // study DTO (for example sources, availableLanguages, and meaning.sourceId).
  // Keep every JSON field while sorting keys so content-addressed ids stay stable.
  return canonicalJson(entry) as StudyWordEntry;
}

export function entryHash(entry: StudyWordEntry): string {
  return createHash("sha256").update(JSON.stringify(canonicalEntry(entry))).digest("hex");
}

/** Stable content identity shared by `dictionary_entries.id` and account exports. */
export function entryIdOf(entry: StudyWordEntry): string {
  return `entry-${entryHash(entry)}`;
}
