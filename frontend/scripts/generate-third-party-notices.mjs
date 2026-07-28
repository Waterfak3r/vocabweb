import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const notices = [];

for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
  if (!packagePath.startsWith("node_modules/") || metadata.dev === true) continue;
  const packageDirectory = resolve(root, packagePath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
  } catch {
    continue;
  }
  const licenseFile = (await readdir(packageDirectory)).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
  const licenseText = licenseFile ? await readFile(resolve(packageDirectory, licenseFile), "utf8") : "";
  notices.push({
    name: `${manifest.name ?? packagePath.slice("node_modules/".length)}@${manifest.version ?? metadata.version ?? "unknown"}`,
    license: manifest.license ?? metadata.license ?? "SEE PACKAGE",
    licenseText: licenseText.trim(),
  });
}

notices.sort((left, right) => left.name.localeCompare(right.name));
const output = [
  "WECreate Vocab — Third-Party Notices",
  "Generated from production frontend dependencies. Dictionary dataset licenses are packaged separately under resources/dictionaries/generated/licenses.",
  "",
  ...notices.flatMap((notice) => [
    "=".repeat(80),
    notice.name,
    `Declared license: ${notice.license}`,
    "-".repeat(80),
    notice.licenseText || "No standalone license file was present in the installed package; consult the package metadata.",
    "",
  ]),
].join("\n");

await writeFile(resolve(root, "public", "THIRD_PARTY_NOTICES.txt"), `${output}\n`, "utf8");
console.log(`Generated notices for ${notices.length} production frontend packages`);
