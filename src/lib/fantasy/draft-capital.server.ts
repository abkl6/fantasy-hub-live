/**
 * Draft capital for every player: round, pick and year.
 *
 * Sleeper's player feed does not carry draft results, so this reads the public
 * nflverse players file — one CSV, matched to our players by normalized name
 * and position. A failure here never breaks a sync; the features that use
 * draft capital simply stay off.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { normalizeName } from "./names";

type DB = SupabaseClient<Database>;

const SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";

/** Minimal CSV reader: handles quoted fields, no embedded newlines. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface DraftRow {
  norm: string;
  position: string;
  round: number | null;
  pick: number | null;
  year: number | null;
}

export function parseDraftCsv(text: string): DraftRow[] {
  const lines = text.split("\n");
  const header = parseCsvLine(lines[0] ?? "");
  const at = (name: string) => header.indexOf(name);
  const iName = at("display_name");
  const iPos = at("position");
  const iRound = at("draft_round");
  const iPick = at("draft_pick");
  const iYear = at("draft_year");
  if (iName < 0 || iRound < 0) return [];

  const num = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 ? n : null;
  };

  const out: DraftRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = parseCsvLine(line);
    const name = cells[iName];
    if (!name) continue;
    const round = num(cells[iRound]);
    if (round == null) continue;
    out.push({
      norm: normalizeName(name),
      position: String(cells[iPos] ?? "").toUpperCase(),
      round,
      pick: num(cells[iPick]),
      year: num(cells[iYear]),
    });
  }
  return out;
}

/** Fetches the public file and writes round/pick/year onto matched players. */
export async function syncDraftCapital(admin: DB) {
  const response = await fetch(SOURCE, { headers: { accept: "text/csv" } });
  if (!response.ok) throw new Error(`Draft file returned ${response.status}`);
  const rows = parseDraftCsv(await response.text());
  if (!rows.length) throw new Error("Draft file had no usable rows");

  const byKey = new Map<string, DraftRow>();
  for (const row of rows) {
    byKey.set(`${row.norm}|${row.position}`, row);
    if (!byKey.has(row.norm)) byKey.set(row.norm, row);
  }

  const { data: players } = await admin
    .from("players")
    .select("id, full_name, position, draft_round");
  let matched = 0;
  const updates: { id: string; round: number; pick: number | null; year: number | null }[] = [];
  for (const p of players ?? []) {
    const norm = normalizeName(String(p.full_name));
    const hit = byKey.get(`${norm}|${String(p.position).toUpperCase()}`) ?? byKey.get(norm);
    if (!hit?.round) continue;
    matched += 1;
    if (p.draft_round === hit.round) continue;
    updates.push({ id: p.id, round: hit.round, pick: hit.pick, year: hit.year });
  }

  for (const u of updates) {
    await admin
      .from("players")
      .update({ draft_round: u.round, draft_pick: u.pick, draft_year: u.year })
      .eq("id", u.id);
  }

  return { scanned: rows.length, matched, updated: updates.length };
}
