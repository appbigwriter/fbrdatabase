import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ALLOWED_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".json", ".md", ".sql"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".aiox-core",
  ".claude",
  ".codex",
  ".cursor",
  ".gemini",
  ".kimi",
  ".antigravity",
  ".github"
]);
const issues = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    if (/^(<{7}|={7}|>{7})/m.test(content)) {
      issues.push(`${fullPath}: merge conflict markers found`);
    }
  }
}

await walk(ROOT);

if (issues.length > 0) {
  console.error("Lint failed:\n" + issues.join("\n"));
  process.exit(1);
}

console.log("Lint passed");
