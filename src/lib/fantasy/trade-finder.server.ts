/**
 * Trade Finder: ranks the other teams in a league by how well their weakest
 * starting slot lines up with my deepest position, then builds the best
 * two-for-one or two-for-two package it can find for each of them. Prices use
 * the league's own scoring and the league's selected projection source.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { optimalLineup, slotAccepts, type EnginePlayer, type Slot } from "./engine";
import { normalizeName } from "./names";
import { loadLeague } from "./proposal.server";
import { leagueScoring } from "./scoring";
import { fairnessLabel } from "./trade-value";
import type { TradeFinderAsset, TradeFinderIdea, TradeFinderPayload } from "./trade-finder-types";

export type * from "./trade-finder-types";

type DB = SupabaseClient<Database>;

const BENCH_SLOT = new Set(["BN", "IR", "TAXI"]);
/** Kickers and defences never drive a trade. */
const IGNORED = new Set(["K", "PK", "DEF", "DST"]);

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Ctx {
  slots: Slot[];
  values: Awaited<ReturnType<typeof loadLeague>>["values"];
  seasonProj: Map<string, number>;
}

function valueOf(ctx: Ctx, p: EnginePlayer) {
  return Math.round(
    ctx.values.player(p.id, p.name, p.position, ctx.seasonProj.get(normalizeName(p.name)) ?? p.proj * 17),
  );
}

const assetOf = (ctx: Ctx, p: EnginePlayer): TradeFinderAsset => ({
  name: p.name,
  position: p.position,
  proj: round1(p.proj),
  value: valueOf(ctx, p),
});

/** The starting slot a roster fills worst, ignoring kickers and defences. */
function weakestSlot(roster: EnginePlayer[], slots: Slot[]) {
  const { starters } = optimalLineup(roster, slots);
  let worst: { slot: string; proj: number } | null = null;
  for (const s of starters) {
    const slot = String(s.slot).toUpperCase();
    if (BENCH_SLOT.has(slot) || IGNORED.has(slot)) continue;
    const proj = s.player?.proj ?? 0;
    if (!worst || proj < worst.proj) worst = { slot: String(s.slot), proj };
  }
  return worst;
}

/** Players not in my best lineup, best first — the pieces I can afford to move. */
function surplus(roster: EnginePlayer[], slots: Slot[]) {
  return optimalLineup(roster, slots)
    .bench.filter((p) => !IGNORED.has(p.position.toUpperCase()))
    .sort((a, b) => b.proj - a.proj);
}

function swap(roster: EnginePlayer[], out: EnginePlayer[], incoming: EnginePlayer[]) {
  const names = new Set(out.map((p) => normalizeName(p.name)));
  return [...roster.filter((p) => !names.has(normalizeName(p.name))), ...incoming];
}

function offerMessage(
  leagueName: string,
  theirName: string,
  iGive: TradeFinderAsset[],
  iGet: TradeFinderAsset[],
  theirDelta: number,
) {
  const list = (a: TradeFinderAsset[]) => a.map((x) => `${x.name} (${x.position})`).join(" + ");
  const help =
    theirDelta > 0
      ? `On my numbers it adds about ${theirDelta.toFixed(1)} points a week to your starting lineup.`
      : "It is close to even on weekly points, and it cleans up both rosters.";
  return `${leagueName} — trade offer for ${theirName}:\n\nYou get: ${list(iGive)}\nI get: ${list(iGet)}\n\n${help} Happy to tweak it if the shape is wrong.`;
}

export async function buildTradeFinder(supabase: DB, leagueId: string): Promise<TradeFinderPayload> {
  const loaded = await loadLeague(supabase, leagueId);
  const slots = loaded.slots as Slot[];
  const ctx: Ctx = { slots, values: loaded.values, seasonProj: loaded.seasonProj };

  const scoring = leagueScoring(
    loaded.league.scoring_type,
    (loaded.league.scoring_rules ?? {}) as Record<string, number>,
  );
  const base: Omit<TradeFinderPayload, "ideas"> = {
    leagueId,
    leagueName: loaded.league.name,
    hasMyTeam: false,
    myTeamName: null,
    projectionLabel: loaded.league.projection_source === "user" ? "My projections" : "League projections",
    scoringLabel: scoring.label,
  };

  const mine = loaded.teams.find((t) => t.isMine);
  if (!mine) return { ...base, ideas: [] };

  const myRoster = loaded.rosters.get(mine.id) ?? [];
  if (!myRoster.length) return { ...base, hasMyTeam: true, myTeamName: mine.name, ideas: [] };

  const myBase = optimalLineup(myRoster, slots).total;
  const myWeak = weakestSlot(myRoster, slots);
  const mySurplus = surplus(myRoster, slots);
  const myDeepPosition = mySurplus[0]?.position ?? "—";

  const ideas: TradeFinderIdea[] = [];

  for (const team of loaded.teams) {
    if (team.id === mine.id) continue;
    const theirRoster = loaded.rosters.get(team.id) ?? [];
    if (theirRoster.length < 5) continue;

    const theirBase = optimalLineup(theirRoster, slots).total;
    const theirWeak = weakestSlot(theirRoster, slots);
    if (!theirWeak) continue;

    // My best piece that would slot straight into their hole.
    const myFits = mySurplus.filter((p) => slotAccepts(theirWeak.slot as Slot, p.position)).slice(0, 2);
    if (!myFits.length) continue;
    const fitScore = round1((myFits[0]!.proj - theirWeak.proj) * 1.0);

    // What I want back: their players who help my own weakest slot most.
    const wants = theirRoster
      .filter((p) => !IGNORED.has(p.position.toUpperCase()))
      .filter((p) => (myWeak ? slotAccepts(myWeak.slot as Slot, p.position) : true))
      .sort((a, b) => b.proj - a.proj)
      .slice(0, 3);
    if (!wants.length) continue;

    // Sweeteners: my next-best movable pieces, cheapest first.
    const sweeteners = mySurplus.filter((p) => !myFits.includes(p)).slice(0, 4);
    const theirSpare = surplus(theirRoster, slots).slice(0, 3);

    let best: TradeFinderIdea | null = null;

    for (const anchor of myFits) {
      for (const sweet of sweeteners) {
        if (sweet.name === anchor.name) continue;
        for (const want of wants) {
          const combos: { iGive: EnginePlayer[]; iGet: EnginePlayer[]; shape: "2-for-1" | "2-for-2" }[] = [
            { iGive: [anchor, sweet], iGet: [want], shape: "2-for-1" },
            ...theirSpare
              .filter((p) => p.name !== want.name)
              .slice(0, 2)
              .map((extra) => ({
                iGive: [anchor, sweet],
                iGet: [want, extra],
                shape: "2-for-2" as const,
              })),
          ];

          for (const combo of combos) {
            const myAfter = optimalLineup(swap(myRoster, combo.iGive, combo.iGet), slots).total;
            const theirAfter = optimalLineup(swap(theirRoster, combo.iGet, combo.iGive), slots).total;
            const myDelta = myAfter - myBase;
            const theirDelta = theirAfter - theirBase;
            if (myDelta <= 0.2) continue;

            const giveAssets = combo.iGive.map((p) => assetOf(ctx, p));
            const getAssets = combo.iGet.map((p) => assetOf(ctx, p));
            const giveValue = giveAssets.reduce((s, a) => s + a.value, 0);
            const getValue = getAssets.reduce((s, a) => s + a.value, 0);
            const avg = Math.max(1, (giveValue + getValue) / 2);
            const fairness = Math.round(Math.max(0, 100 - (Math.abs(giveValue - getValue) / avg) * 100));

            // A deal only happens if it reads well for them too.
            const score = myDelta + theirDelta * 0.8 + (fairness / 100) * 4;
            if (best && score <= best.fitScore) continue;

            best = {
              teamId: team.id,
              teamName: team.name,
              fitReason: `Their ${theirWeak.slot} is their thinnest starting spot (${round1(theirWeak.proj)} proj) and ${myDeepPosition} is where you have the most left over.`,
              theirWeakSlot: String(theirWeak.slot),
              myDeepPosition,
              fitScore: score,
              shape: combo.shape,
              iGive: giveAssets,
              iGet: getAssets,
              myPointsDelta: round1(myDelta),
              theirPointsDelta: round1(theirDelta),
              fairness,
              fairnessText: fairnessLabel(giveValue, getValue),
              valueGap: Math.round(giveValue - getValue),
              offerText: offerMessage(loaded.league.name, team.name, giveAssets, getAssets, theirDelta),
            };
          }
        }
      }
    }

    if (best) ideas.push({ ...best, fitScore: round1(fitScore) });
  }

  ideas.sort(
    (a, b) =>
      b.myPointsDelta + b.theirPointsDelta * 0.8 - (a.myPointsDelta + a.theirPointsDelta * 0.8) ||
      b.fairness - a.fairness,
  );

  return { ...base, hasMyTeam: true, myTeamName: mine.name, ideas };
}
