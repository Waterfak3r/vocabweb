#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "./config.js";
import { SqliteStudyStore } from "./study/sqlite-store.js";

function outputArgument(): string {
  const index = process.argv.indexOf("--output");
  return index >= 0 ? process.argv[index + 1]?.trim() ?? "" : "";
}

async function main(): Promise<void> {
  const output = outputArgument();
  if (!output) throw new Error("Usage: npm run backup -- --output <backup.sqlite>");
  const config = loadConfig();
  const source = resolve(config.databaseFile);
  const destination = resolve(output);
  if (source === destination) throw new Error("Backup output must differ from DATABASE_FILE");

  await mkdir(dirname(destination), { recursive: true });
  const store = new SqliteStudyStore(config.databaseFile, { legacyJsonFile: config.dataFile });
  try {
    await store.backup(destination);
  } finally {
    store.close();
  }

  const verification = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = verification.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (result[0]?.integrity_check !== "ok") throw new Error("Backup integrity_check failed");
  } finally {
    verification.close();
  }
  console.log(`Verified SQLite backup written to ${destination}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
