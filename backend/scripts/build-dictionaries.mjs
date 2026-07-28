import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import YAML from "yaml";

const OEWN_COMMIT = "dc343f2683279ecbb13fab4e2fd778d7b162d287";
const ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
const output = resolve(process.argv[2] ?? "../resources/dictionaries/generated/vocab.sqlite");
if (!process.argv.includes("--force")) {
  try {
    const existing = new Database(output, { readonly: true, fileMustExist: true });
    const metadata = Object.fromEntries(existing.prepare("SELECT key, value FROM dictionary_metadata").all().map((row) => [row.key, row.value]));
    existing.close();
    if (metadata.oewn_commit === OEWN_COMMIT && metadata.ecdict_commit === ECDICT_COMMIT) {
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

function normalizeWord(value) {
  return String(value).normalize("NFC").trim().toLowerCase().replaceAll("’", "'");
}

function validLemma(value) {
  return /^[a-z]+(?:['-][a-z]+)*$/.test(value);
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

async function clonePinned(url, commit, target) {
  await run("git", ["clone", "--filter=blob:none", "--no-checkout", url, target]);
  await run("git", ["fetch", "--depth", "1", "origin", commit], target);
  await run("git", ["checkout", "--detach", commit], target);
}

await mkdir(dirname(output), { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), "vacabweb-dictionaries-"));
const oewnDir = resolve(temp, "oewn");
const ecdictDir = resolve(temp, "ecdict");

try {
  await clonePinned("https://github.com/globalwordnet/english-wordnet.git", OEWN_COMMIT, oewnDir);
  await clonePinned("https://github.com/skywind3000/ECDICT.git", ECDICT_COMMIT, ecdictDir);
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
    INSERT INTO dictionary_meanings(lemma, pos, definition, example, source_record_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
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
          const lemma = normalizeWord(member);
          if (!validLemma(lemma)) continue;
          ensureEntry.run(lemma);
          definitions.forEach((definition, index) => {
            const text = String(definition).trim();
            if (text) insertMeaning.run(lemma, pos, text, examples[index] ? String(examples[index]).trim() : null, `${file}:${recordId}`, meaningOrder++);
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
      const lemma = normalizeWord(fields[columns.word] ?? "");
      if (!validLemma(lemma)) continue;
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

  const metadata = db.prepare("INSERT INTO dictionary_metadata(key, value) VALUES (?, ?)");
  metadata.run("schema_version", "1");
  metadata.run("oewn_commit", OEWN_COMMIT);
  metadata.run("ecdict_commit", ECDICT_COMMIT);
  metadata.run("built_at", new Date().toISOString());
  metadata.run("ecdict_sha256", createHash("sha256").update(ecdictContent).digest("hex"));
  db.exec("ANALYZE; VACUUM;");
  const counts = {
    entries: db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries").get().count,
    meanings: db.prepare("SELECT COUNT(*) AS count FROM dictionary_meanings").get().count,
    bilingual: db.prepare("SELECT COUNT(*) AS count FROM dictionary_entries WHERE zh_meaning IS NOT NULL AND EXISTS (SELECT 1 FROM dictionary_meanings m WHERE m.lemma = dictionary_entries.lemma)").get().count,
  };
  db.close();
  console.log(`Dictionary built at ${output}`, counts);
} finally {
  await rm(temp, { recursive: true, force: true });
}
