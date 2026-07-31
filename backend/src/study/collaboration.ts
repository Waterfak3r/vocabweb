import { normalizeWord } from "../words/normalize.js";
import type {
  CatalogConflict,
  CatalogDiffStats,
  CatalogRevision,
  CatalogWordChange,
  StudyWordEntry,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalEntry(entry: StudyWordEntry): StudyWordEntry {
  return {
    word: normalizeWord(entry.word),
    phonetic: entry.phonetic,
    ...(entry.audioUrl ? { audioUrl: entry.audioUrl } : {}),
    meanings: entry.meanings.map((meaning) => ({
      pos: meaning.pos,
      definition: meaning.definition,
      ...(meaning.example ? { example: meaning.example } : {}),
    })),
    source: entry.source,
    ...(entry.zhMeaning ? { zhMeaning: entry.zhMeaning } : {}),
    ...(entry.zhMeaningSource ? { zhMeaningSource: entry.zhMeaningSource } : {}),
  };
}

export function sameCatalogWord(left: StudyWordEntry | undefined, right: StudyWordEntry | undefined): boolean {
  if (!left || !right) return left === right;
  const content = (entry: StudyWordEntry) => {
    const normalized = canonicalEntry(entry);
    return {
      word: normalized.word,
      phonetic: normalized.phonetic,
      ...(normalized.audioUrl ? { audioUrl: normalized.audioUrl } : {}),
      meanings: normalized.meanings,
      ...(normalized.zhMeaning ? { zhMeaning: normalized.zhMeaning } : {}),
    };
  };
  return JSON.stringify(content(left)) === JSON.stringify(content(right));
}

/** Internal dictionary provenance is metadata, not a public wordbook change. */
export function meaningfulCatalogChanges(changes: CatalogWordChange[]): CatalogWordChange[] {
  return changes.filter((change) => (
    change.kind !== "update" || !sameCatalogWord(change.before, change.after)
  ));
}

function wordMap(words: StudyWordEntry[]): Map<string, StudyWordEntry> {
  return new Map(words.map((entry) => {
    const normalized = canonicalEntry(entry);
    return [normalized.word, normalized] as const;
  }));
}

export function catalogDiffStats(changes: CatalogWordChange[]): CatalogDiffStats {
  const meaningful = meaningfulCatalogChanges(changes);
  const additions = meaningful.filter((change) => change.kind === "add").length;
  const deletions = meaningful.filter((change) => change.kind === "delete").length;
  const updates = meaningful.filter((change) => change.kind === "update").length;
  return { additions, deletions, updates, changedWords: meaningful.length };
}

/** A deterministic, immutable word-level diff. Renames naturally become delete + add. */
export function diffCatalogWords(before: StudyWordEntry[], after: StudyWordEntry[]): CatalogWordChange[] {
  const beforeByKey = wordMap(before);
  const afterByKey = wordMap(after);
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort((left, right) => left.localeCompare(right));
  const changes: CatalogWordChange[] = [];
  for (const key of keys) {
    const oldValue = beforeByKey.get(key);
    const newValue = afterByKey.get(key);
    if (!oldValue && newValue) changes.push({ kind: "add", key, after: clone(newValue) });
    else if (oldValue && !newValue) changes.push({ kind: "delete", key, before: clone(oldValue) });
    else if (oldValue && newValue && !sameCatalogWord(oldValue, newValue)) {
      changes.push({ kind: "update", key, before: clone(oldValue), after: clone(newValue) });
    }
  }
  return changes;
}

/** Apply a trusted revision while keeping the canonical spelling order stable. */
export function applyCatalogChanges(words: StudyWordEntry[], changes: CatalogWordChange[]): StudyWordEntry[] {
  const result = wordMap(words);
  for (const change of changes) {
    if (change.kind === "delete") result.delete(change.key);
    else result.set(change.key, canonicalEntry(change.after));
  }
  return [...result.values()].sort((left, right) => left.word.localeCompare(right.word));
}

export function catalogAtRevision(revisions: CatalogRevision[], revisionId: string): StudyWordEntry[] | null {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const chain: CatalogRevision[] = [];
  const visited = new Set<string>();
  let current = byId.get(revisionId);
  while (current) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    chain.push(current);
    current = current.parentRevisionId ? byId.get(current.parentRevisionId) : undefined;
  }
  if (!chain.length) return null;
  let words: StudyWordEntry[] = [];
  for (const revision of chain.reverse()) words = applyCatalogChanges(words, revision.changes);
  return words;
}

export function threeWayContribution(
  baseline: StudyWordEntry[],
  personal: StudyWordEntry[],
  head: StudyWordEntry[],
): { changes: CatalogWordChange[]; overlaps: CatalogConflict[] } {
  const intent = diffCatalogWords(baseline, personal);
  const baselineByKey = wordMap(baseline);
  const headByKey = wordMap(head);
  const desired = wordMap(head);
  const overlaps: CatalogConflict[] = [];

  for (const change of intent) {
    const baseValue = baselineByKey.get(change.key);
    const headValue = headByKey.get(change.key);
    if (!sameCatalogWord(baseValue, headValue)) {
      overlaps.push({
        key: change.key,
        reason: "overlapping-change",
        ...(baseValue ? { base: clone(baseValue) } : {}),
        ...(headValue ? { current: clone(headValue) } : {}),
        ...(change.kind === "delete" ? {} : { proposed: clone(change.after) }),
      });
    }
    if (change.kind === "delete") desired.delete(change.key);
    else desired.set(change.key, canonicalEntry(change.after));
  }

  return {
    changes: diffCatalogWords([...headByKey.values()], [...desired.values()]),
    overlaps,
  };
}

/**
 * A submitted contribution is safe only while every touched public entry is still the
 * exact value shown to the contributor. This returns the effective immutable merge diff.
 */
export function validateContributionMerge(
  head: StudyWordEntry[],
  changes: CatalogWordChange[],
): { changes: CatalogWordChange[]; conflicts: CatalogConflict[] } {
  const current = wordMap(head);
  const conflicts: CatalogConflict[] = [];
  const meaningful = meaningfulCatalogChanges(changes);
  for (const change of meaningful) {
    const currentValue = current.get(change.key);
    const expected = change.kind === "add" ? undefined : change.before;
    if (!sameCatalogWord(currentValue, expected)) {
      conflicts.push({
        key: change.key,
        reason: "overlapping-change",
        ...(expected ? { base: clone(expected) } : {}),
        ...(currentValue ? { current: clone(currentValue) } : {}),
        ...(change.kind === "delete" ? {} : { proposed: clone(change.after) }),
      });
    }
  }
  return { changes: clone(meaningful), conflicts };
}

export function inverseRevisionAgainstHead(
  target: CatalogRevision,
  head: StudyWordEntry[],
): { changes: CatalogWordChange[]; conflicts: CatalogConflict[]; alreadyReverted: boolean } {
  const current = wordMap(head);
  const changes: CatalogWordChange[] = [];
  const conflicts: CatalogConflict[] = [];
  let alreadyReverted = true;

  for (const original of target.changes) {
    const currentValue = current.get(original.key);
    if (original.kind === "add") {
      if (!currentValue) continue;
      if (sameCatalogWord(currentValue, original.after)) {
        alreadyReverted = false;
        changes.push({ kind: "delete", key: original.key, before: clone(currentValue) });
      } else {
        alreadyReverted = false;
        conflicts.push({
          key: original.key,
          reason: "overlapping-change",
          current: clone(currentValue),
          proposed: clone(original.after),
        });
      }
      continue;
    }
    if (original.kind === "delete") {
      if (!currentValue) {
        alreadyReverted = false;
        changes.push({ kind: "add", key: original.key, after: clone(original.before) });
      } else if (!sameCatalogWord(currentValue, original.before)) {
        alreadyReverted = false;
        conflicts.push({
          key: original.key,
          reason: "overlapping-change",
          base: clone(original.before),
          current: clone(currentValue),
        });
      }
      continue;
    }
    if (sameCatalogWord(currentValue, original.before)) continue;
    if (currentValue && sameCatalogWord(currentValue, original.after)) {
      alreadyReverted = false;
      changes.push({
        kind: "update",
        key: original.key,
        before: clone(currentValue),
        after: clone(original.before),
      });
    } else {
      alreadyReverted = false;
      conflicts.push({
        key: original.key,
        reason: "overlapping-change",
        base: clone(original.after),
        ...(currentValue ? { current: clone(currentValue) } : {}),
        proposed: clone(original.before),
      });
    }
  }

  return {
    changes: changes.sort((left, right) => left.key.localeCompare(right.key)),
    conflicts,
    alreadyReverted: alreadyReverted && conflicts.length === 0,
  };
}
