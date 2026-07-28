import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import YAML from "yaml";
import {
  DICTIONARY_IMPORTER_VERSION,
  isValidDictionaryLemma,
  normalizeDictionaryLemma,
} from "./dictionary-lemma.mjs";

const OEWN_COMMIT = "dc343f2683279ecbb13fab4e2fd778d7b162d287";
const ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
const WIKTEXTRACT_FILE = process.env.WIKTEXTRACT_JSONL_GZ?.trim();
const WIKTEXTRACT_DUMP_DATE = process.env.WIKTEXTRACT_DUMP_DATE?.trim();
const WIKTEXTRACT_SHA256 = process.env.WIKTEXTRACT_SHA256?.trim()?.toLowerCase();
const output = resolve(process.argv[2] ?? "../resources/dictionaries/generated/vocab.sqlite");
const licenseOutput = resolve(dirname(output), "licenses");
const requestedWiktextractDate = WIKTEXTRACT_FILE ? WIKTEXTRACT_DUMP_DATE : "not-imported";
const requestedWiktextractHash = WIKTEXTRACT_FILE ? WIKTEXTRACT_SHA256 : "not-imported";
if (!process.argv.includes("--force")) {
  try {
    const existing = new Database(output, { readonly: true, fileMustExist: true });
    const metadata = Object.fromEntries(existing.prepare("SELECT key, value FROM dictionary_metadata").all().map((row) => [row.key, row.value]));
    existing.close();
    if (
      metadata.oewn_commit === OEWN_COMMIT
      && metadata.ecdict_commit === ECDICT_COMMIT
      && metadata.importer_version === DICTIONARY_IMPORTER_VERSION
      && metadata.wiktextract_dump_date === requestedWiktextractDate
      && metadata.wiktextract_sha256 === requestedWiktextractHash
    ) {
      await access(resolve(licenseOutput, "open-english-wordnet-LICENSE"));
      await access(resolve(licenseOutput, "ecdict-LICENSE"));
      console.log(`Dictionary is up to date at ${output}`);
      process.exit(0);
    }
  } catch { /* Build a missing or incompatible artifact. */ }
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function parseCsv(content) {
  const rows = [];
  let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"' && quoted && content[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function clonePinned(url, commit, target) {
  await run("git", ["clone", "--filter=blob:none", "--no-checkout", url, target]);
  await run("git", ["fetch", "--depth", "1", "origin", commit], target);
  await run("git", ["checkout", "--detach", commit], target);
}

async function copyRepositoryLicense(repository, targetName) {
  const license = (await readdir(repository)).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  if (!license) throw new Error(`No license file found in ${repository}`);
  await mkdir(licenseOutput, { recursive: true });
  await copyFile(resolve(repository, license), resolve(licenseOutput, targetName));
}

await mkdir(dirname(output), { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "vacabweb-dictionaries-"));
const oewnDir = resolve(temp, "oewn");
const ecdictDir = resolve(temp, "ecdict");

try {
  await clonePinned("https://github.com/globalwordnet/english-wordnet.git", OEWN_COMMIT, oewnDir);
  await clonePinned("https://github.com/skywind3000/ECDICT.git", ECDICT_COMMIT, ecdictDir);
  await copyRepositoryLicense(oewnDir, "open-english-wordnet-LICENSE");
  await copyRepositoryLicense(ecdictDir, "ecdict-LICENSE");
  await rm(output, { force: true });
  const db = new Database(output);
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.exec(`
    CREATE TABLE dictionary_entries (
      lemma TEXT PRIMARY KEY,
      phonetic TEXT NOT NULL DEFAULT '',
      zh_meaning TEXT,
      tags TEXT NOT NULL DEFAULT '',
      bnc INTEGER,
      frq INTEGER
    );
    CREATE TABLE dictionary_meanings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lemma TEXT NOT NULL REFERENCES dictionary_entries(lemma) ON DELETE CASCADE,
      pos TEXT NOT NULL,
      definition TEXT NOT NULL,
      example TEXT,
      source_record_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE INDEX dictionary_meanings_lemma_order_idx
      ON dictionary_meanings(lemma, sort_order);
    CREATE TABLE dictionary_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const ensureEntry = db.prepare("INSERT INTO dictionary_entries(lemma) VALUES (?) ON CONFLICT DO NOTHING");
  const insertMeaning = db.prepare(`
    INSERT INTO dictionary_meanings(lemma, pos, definition, example, source_record_id, source_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const yamlFiles = (await readdir(resolve(oewnDir, "src/yaml"))).filter((name) => name.endsWith(".yaml")).sort();
  let meaningOrder = 0;
  const importOewn = db.transaction((documents) => {
    for (const [file, document] of documents) {
      for (const [recordId, raw] of Object.entries(document ?? {})) {
        const members = Array.isArray(raw?.members) ? raw.members : [];
        const definitions = Array.isArray(raw?.definition) ? raw.definition : [];
        const examples = Array.isArray(raw?.example) ? raw.example : [];
        const pos = String(raw?.partOfSpeech ?? "");
        for (const member of members) {
          const lemma = normalizeDictionaryLemma(member);
          if (!isValidDictionaryLemma(lemma)) continue;
          ensureEntry.run(lemma);
          definitions.forEach((definition, index) => {
            const text = String(definition).trim();
            if (text) insertMeaning.run(lemma, pos, text, examples[index] ? String(examples[index]).trim() : null, `${file}:${recordId}`, "open_english_wordnet", meaningOrder++);
          });
        }
      }
    }
  });
  const documents = [];
  for (const file of yamlFiles) {
    documents.push([file, YAML.parse(await readFile(resolve(oewnDir, "src/yaml", file), "utf8"))]);
  }
  importOewn(documents);

  const ecdictContent = await readFile(resolve(ecdictDir, "ecdict.csv"), "utf8");
  const rows = parseCsv(ecdictContent);
  const header = rows.shift() ?? [];
  const columns = Object.fromEntries(header.map((name, index) => [name.trim(), index]));
  const upsertChinese = db.prepare(`
    INSERT INTO dictionary_entries(lemma, phonetic, zh_meaning, tags, bnc, frq)
    VALUES (@lemma, @phonetic, @zhMeaning, @tags, @bnc, @frq)
    ON CONFLICT(lemma) DO UPDATE SET
      phonetic = CASE WHEN excluded.phonetic <> '' THEN excluded.phonetic ELSE dictionary_entries.phonetic END,
      zh_meaning = COALESCE(excluded.zh_meaning, dictionary_entries.zh_meaning),
      tags = excluded.tags,
      bnc = excluded.bnc,
      frq = excluded.frq
  `);
  const integer = (value) => /^\d+$/.test(value?.trim() ?? "") && Number(value) > 0 ? Number(value) : null;
  const importEcdict = db.transaction((items) => {
    for (const fields of items) {
      const lemma = normalizeDictionaryLemma(fields[columns.word] ?? "");
      if (!isValidDictionaryLemma(lemma)) continue;
      const zhMeaning = (fields[columns.translation] ?? "").replaceAll("\\n", "\n").trim() || null;
      upsertChinese.run({
        lemma,
        phonetic: (fields[columns.phonetic] ?? "").trim(),
        zhMeaning,
        tags: (fields[columns.tag] ?? "").trim().toLowerCase(),
        bnc: integer(fields[columns.bnc]),
        frq: integer(fields[columns.frq]),
      });
    }
  });
  importEcdict(rows);

  let wiktionaryMeanings = 0;
  if (WIKTEXTRACT_FILE) {
    if (!WIKTEXTRACT_DUMP_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(WIKTEXTRACT_DUMP_DATE)) {
      throw new Error("WIKTEXTRACT_DUMP_DATE=YYYY-MM-DD is required with WIKTEXTRACT_JSONL_GZ");
    }
    if (!WIKTEXTRACT_SHA256 || !/^[a-f0-9]{64}$/.test(WIKTEXTRACT_SHA256)) {
      throw new Error("WIKTEXTRACT_SHA256 is required with WIKTEXTRACT_JSONL_GZ");
    }
    const actualHash = await sha256File(resolve(WIKTEXTRACT_FILE));
    if (actualHash !== WIKTEXTRACT_SHA256) throw new Error("Wiktextract checksum does not match");

    const hasOewnMeaning = db.prepare(`
      SELECT 1
      FROM dictionary_meanings
      WHERE lemma = ? AND source_id = 'open_english_wordnet'
      LIMIT 1
    `);
    const importLine = db.transaction((record) => {
      const lemma = normalizeDictionaryLemma(record?.word ?? "");
      if (
        (record?.lang_code && record.lang_code !== "en")
        || !isValidDictionaryLemma(lemma)
        || !lemma.includes(" ")
        || hasOewnMeaning.get(lemma)
      ) return;
      const pos = String(record?.pos ?? "phrase").trim().toLowerCase() || "phrase";
      ensureEntry.run(lemma);
      for (const [senseIndex, sense] of (Array.isArray(record?.senses) ? record.senses : []).entries()) {
        if (sense?.tags?.includes("form-of") || sense?.tags?.includes("translation-hub")) continue;
        const gloss = Array.isArray(sense?.glosses)
          ? sense.glosses.find((value) => typeof value === "string" && value.trim())
          : undefined;
        if (!gloss) continue;
        const example = Array.isArray(sense.examples)
          ? sense.examples.find((value) => typeof value?.text === "string")?.text?.trim() || null
          : null;
        insertMeaning.run(
          lemma,
          pos,
          gloss.trim(),
          example,
          `${record.original_title ?? record.word}:${senseIndex}`,
          "wiktionary",
          meaningOrder++,
        );
        wiktionaryMeanings += 1;
        if (wiktionaryMeanings % 10_000 === 0) console.log(`Imported ${wiktionaryMeanings} Wiktionary phrase meanings`);
      }
    });
    const lines = createInterface({
      input: createReadStream(resolve(WIKTEXTRACT_FILE)).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      importLine(JSON.parse(line));
    }
  }

  const metadata = db.prepare("INSERT INTO dictionary_metadata(key, value) VALUES (?, ?)");
  metadata.run("schema_version", "1");
  metadata.run("importer_version", DICTIONARY_IMPORTER_VERSION);
  metadata.run("oewn_commit", OEWN_COMMIT);
  metadata.run("ecdict_commit", ECDICT_COMMIT);
  metadata.run("wiktextract_dump_date", WIKTEXTRACT_DUMP_DATE ?? "not-imported");
  metadata.run("wiktextract_sha256", WIKTEXTRACT_SHA256 ?? "not-imported");
  metadata.run("built_at", new Date().toISOString());
  metadata.run("ecdict_sha256", createHash("sha256").update(ecdictContent).digest("hex"));
  const counts = {
    entries: db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries").get().count,
    meanings: db.prepare("SELECT COUNT(*) AS count FROM dictionary_meanings").get().count,
    bilingual: db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries WHERE zh_meaning IS NOT NULL AND EXISTS (SELECT 1 FROM dictionary_meanings m WHERE m.lemma = dictionary_entries.lemma)").get().count,
    wiktionaryMeanings,
  };
  for (const [name, value] of Object.entries(counts)) metadata.run(`stats_${name}`, String(value));
  db.exec("ANALYZE; VACUUM;");
  db.close();
  console.log(`Dictionary built at ${output}`, counts);
} finally {
  await rm(temp, { recursive: true, force: true });
}
