import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWord } from "../words/normalize.js";

/** Small, replaceable Chinese-meaning adapter.  It intentionally returns no value on a miss. */
export interface LocalChineseLookup { lookup(word: string): Promise<string | undefined>; }

function parseCsvRow(line: string): string[] {
  const fields: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { fields.push(current); current = ""; }
    else current += char;
  }
  fields.push(current); return fields;
}

export class CsvLocalChineseDictionary implements LocalChineseLookup {
  private dictionary: Promise<Map<string, string>> | undefined;
  constructor(private readonly filePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../resources/dictionaries/samples/ecdict-mini.sample.csv")) {}
  async lookup(word: string): Promise<string | undefined> { return (await (this.dictionary ??= this.load())).get(normalizeWord(word)); }
  private async load(): Promise<Map<string, string>> {
    try {
      const rows = (await readFile(this.filePath, "utf8")).split(/\r?\n/); const map = new Map<string, string>();
      for (const row of rows.slice(1)) {
        if (!row.trim()) continue; const fields = parseCsvRow(row); const head = normalizeWord(fields[0] ?? ""); const translation = (fields[3] ?? "").replace(/\\n/g, "；").trim();
        if (head && translation) map.set(head, translation);
      }
      return map;
    } catch { return new Map(); }
  }
}
