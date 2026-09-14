#!/usr/bin/env node
/**
 * Guard: player names must be compared through src/lib/fantasy/names.ts,
 * never with raw lowercasing. Suffixes ("Jr.", "III") break raw comparisons
 * and split one player into two.
 *
 * Run: node scripts/check-player-names.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src"];
const SKIP = new Set(["names.ts", "names.test.ts"]);
const PATTERN = /(player_name|full_name|\bp\.name|player\.name)[^\n]{0,40}\.toLowerCase\(\)/;

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry) && !SKIP.has(entry)) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (PATTERN.test(line)) offenders.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}
ROOTS.forEach(walk);

if (offenders.length) {
  console.error("Raw player-name lowercasing found. Use normalizeName/playerKey from src/lib/fantasy/names.ts:\n");
  offenders.forEach((o) => console.error("  " + o));
  process.exit(1);
}
console.log("Player-name matching OK.");
