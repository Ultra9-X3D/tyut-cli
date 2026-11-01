import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sensitivePatterns = [
  ["student ID", /(?<!\d)20\d{8}(?!\d)/g],
  ["phone number", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ["Windows user path", /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s"<>]+/g],
  ["password placeholder", /\{\{\s*(?:PASSWORD|PASSWD|SECRET|TOKEN)[^}]*\}\}/gi],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["URL credential", /https?:\/\/[^\s/:@]+:[^\s/@]+@/gi],
];

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "coverage" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("package files contain no common personal records or credentials", () => {
  const hits = [];
  for (const file of files(root)) {
    const text = fs.readFileSync(file, "utf8");
    for (const [kind, pattern] of sensitivePatterns) {
      if (pattern.test(text)) hits.push(`${path.relative(root, file)}: ${kind}`);
      pattern.lastIndex = 0;
    }
  }
  assert.deepEqual(hits, []);
});

test("readme states the read-only boundary", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /不保存密码/);
  assert.match(readme, /选课/);
  assert.match(readme, /校园网/);
  assert.match(readme, /npm install -g tyut-cli/);
  assert.match(readme, /TYUT_PASSWORD/);
  assert.match(readme, /npm test/);
});
