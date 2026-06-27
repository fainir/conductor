#!/usr/bin/env node
// release.mjs — one command to ship a plugin update correctly.
// Bumps the version EVERYWHERE the plugin update check reads it, rebuilds the
// bundle, commits, and pushes. Removes the two footguns: forgetting to rebuild
// (users get stale tools) and forgetting to bump (the update is silently skipped).
//
//   npm run release            # patch: 0.2.0 -> 0.2.1
//   npm run release minor      # 0.2.0 -> 0.3.0
//   npm run release major "msg"

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bump = process.argv[2] ?? "patch";
const msg = process.argv[3] ?? "";

const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next = bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

// Only an exact "version": "X.Y.Z" is rewritten — dependency ranges (e.g. "^1.29.0") are untouched.
const VERSION_RE = /"version":\s*"\d+\.\d+\.\d+"/g;
for (const f of ["package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  const p = resolve(root, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(VERSION_RE, `"version": "${next}"`));
}
console.log(`version ${pkg.version} -> ${next}`);

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
run("npm run build");
run("git add -A");
const commitMsg = `release v${next}${msg ? `: ${msg}` : ""}\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
execSync(`git commit -F -`, { cwd: root, input: commitMsg, stdio: ["pipe", "inherit", "inherit"] });
run("git push origin main");

console.log(`\nReleased v${next}. Installed users update with:`);
console.log("  claude plugin marketplace update conductor");
console.log("  claude plugin update conductor@conductor   # restart to apply");
