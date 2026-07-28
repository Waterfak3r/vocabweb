#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hashPassword, parseAuthCredentials } from "./auth.js";
import { loadConfig } from "./config.js";
import { SqliteStudyStore } from "./study/sqlite-store.js";
import type { UserRole } from "./study/types.js";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() ?? "" : "";
}

function usage(): never {
  console.error([
    "Usage:",
    "  npm run admin -- create --username <name>",
    "  npm run admin -- promote --username <name>",
    "  npm run admin -- demote --username <name>",
    "",
    "The create command reads the password from ADMIN_PASSWORD_FILE.",
    "Use a temporary owner-readable file and remove it immediately afterwards.",
  ].join("\n"));
  process.exit(2);
}

async function passwordFromFile(): Promise<string> {
  const file = process.env.ADMIN_PASSWORD_FILE?.trim();
  if (!file) throw new Error("ADMIN_PASSWORD_FILE is required for admin creation");
  return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
}

async function setRole(store: SqliteStudyStore, username: string, role: UserRole): Promise<void> {
  const user = await store.setUserRole(username, role);
  if (!user) throw new Error(`Account "${username}" does not exist`);
  console.log(`${user.username} is now ${user.role} (${user.id})`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const username = argument("username");
  if (!username || !["create", "promote", "demote"].includes(command ?? "")) usage();

  const config = loadConfig();
  const store = new SqliteStudyStore(config.databaseFile, { legacyJsonFile: config.dataFile });
  try {
    if (command === "promote" || command === "demote") {
      await setRole(store, username, command === "promote" ? "admin" : "user");
      return;
    }

    const password = await passwordFromFile();
    const credentials = parseAuthCredentials({ username, password });
    if (!credentials) throw new Error("Username or password does not meet the account requirements");
    const result = await store.createUser(
      credentials.username,
      await hashPassword(credentials.password),
      `admin-${randomUUID()}`,
    );
    if (result.kind === "taken") throw new Error(`Account "${credentials.username}" already exists; use promote instead`);
    if (result.kind === "client-taken") throw new Error("Generated client id collision; run the command again");
    await setRole(store, result.user.username, "admin");
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
