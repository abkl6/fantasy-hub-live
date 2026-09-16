/**
 * Trade Finder: ranks the other teams in a league by how well their weakest
 * starting slot lines up with my deepest position, then builds the best
 * two-for-one or two-for-two package it can find for each of them. Prices use
 * the league's own scoring and the league's selected projection source.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  optimalLineup,
  recommendationImpact,
  simulateSeason,
  slotAccepts,
  teamDistribution,
  type EnginePlayer,
  type Slot,
} from "./engine";
import { bestBallDistribution } from "./format";
import { EMPTY_IMPACT, impactScore, primaryImpactText, type TeamClass } from "./impact";
import { normalizeName } from "./names";
import { tierFromRank, trajectoryFor } from "./age-curve";
import { loadAgeCurves, type AgeCurveBook } from "./age-curve.server";
import { loadLeague } from "./proposal.server";
import { leagueScoring } from "./scoring";
import { fairnessLabel } from "./trade-value";
import type { TradeFinderAsset, TradeFinderIdea, TradeFinderPayload } from "./trade-finder-types";
import { isStreamPosition } from "./rules";
import { loadStrategyRules } from "./rules.server";

export type * from "./trade-finder-types";

type DB = SupabaseClient<Database>;

const BENCH_SLOT = new Set(["BN", "IR", "TAXI"]);
/** Kickers and defences never drive a trade. */
// Kickers and defences are streamed, never traded for — the strategy layer's
// first rule, applied at the point candidates are chosen.
const IGNORED = new Set(["K", "PK", "DEF", "DST"]);

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Ctx {
  slots: Slot[];
  values: Awaited<ReturnType<typeof loadLeague>>["values"];
  seasonProj: Map<string, number>;
  curves: AgeCurveBook | null;
  teamCount: number;
}

function valueOf(ctx: Ctx, p: EnginePlayer) {
  return Math.round(
    ctx.values.player(p.id, p.name, p.position, ctx.seasonProj.get(normalizeName(p.name)) ?? p.proj * 17),
  );
}

const assetOf = (ctx: Ctx, p: EnginePlayer): TradeFinderAsset => {
  const value = valueOf(ctx, p);
  const age = ctx.curves ? ctx.values.age(p.id, p.name, p.position) : null;
  return {
    name: p.name,
    position: p.position,
    proj: round1(p.proj),
    value,
    trajectory:
      ctx.curves && age != null && value > 0
        ? trajectoryFor({
            position: p.position,
            age,
            value,
            tier: tierFromRank(ctx.values.positionRank(p.id, p.name, p.position), ctx.teamCount, p.position),
            curve: ctx.curves.curve(p.position),
          })
        : null,
  };
};

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

/** Scoring distribution of a roster, for the season simulation. */
function distFor(roster: EnginePlayer[], slots: Slot[], bestBall: boolean) {
  return bestBall ? bestBallDistribution(roster, slots) : teamDistribution(roster, slots);
}

export async function buildTradeFinder(supabase: DB, leagueId: string): Promise<TradeFinderPayload> {
  const loaded = await loadLeague(supabase, leagueId);
  const slots = loaded.slots as Slot[];
  const curves = loaded.isDynasty ? await loadAgeCurves(supabase, loaded.values.format) : null;
  const ctx: Ctx = {
    slots,
    values: loaded.values,
    seasonProj: loaded.seasonProj,
    curves,
    teamCount: loaded.teams.length || 12,
  };

  const scoring = leagueScoring(
    loaded.league.scoring_type,
    (loaded.league.scoring_rules ?? {}) as Record<string, number>,
  );
  const base: Omit<TradeFinderPayload, "ideas"> = {
    teamClass: "middle",
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

  // Every idea is re-simulated with the trade applied, so the card can say what
  // it is actually worth rather than just how the points move.
  const simTeams = loaded.teams.map((t) => ({
    id: t.id,
    name: t.name,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor,
    isMine: t.isMine,
    ...distFor(loaded.rosters.get(t.id) ?? [], slots, loaded.bestBall),
  }));
  const baseline = simulateSeason(simTeams, loaded.simConfig, loaded.schedule, 1500, 7);
  const valueByTeam: Record<string, number> = {};
  for (const t of loaded.teams) {
    valueByTeam[t.id] =
      (loaded.rosters.get(t.id) ?? []).reduce(
        (sum, p) => sum + loaded.values.player(p.id, p.name, p.position, (ctx.seasonProj.get(normalizeName(p.name)) ?? p.proj * 17)),
        0,
      ) + (loaded.picksByTeam.get(t.id) ?? []).reduce((sum, a) => sum + a.value, 0);
  }
  const myClass: TeamClass =
    (baseline.find((r) => r.id === mine.id)?.titleOdds ?? 0) >= 0.15
      ? "contender"
      : (baseline.find((r) => r.id === mine.id)?.playoffOdds ?? 0) <= 0.25
        ? "rebuilder"
        : "middle";

  const book = await loadStrategyRules(supabase);
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
    let bestRoster: EnginePlayer[] = myRoster;
    let bestValueDelta = 0;

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

            bestRoster = swap(myRoster, combo.iGive, combo.iGet);
            bestValueDelta = getValue - giveValue;
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
              impact: EMPTY_IMPACT,
              impactLabel: "",
              impactRank: 0,
            };
          }
        }
      }
    }

    if (best) {
      // One simulation per partner: only the idea that actually gets shown.
      const impact = recommendationImpact({
        teams: simTeams,
        config: loaded.simConfig,
        schedule: loaded.schedule,
        teamId: mine.id,
        baseline,
        after: distFor(bestRoster, slots, loaded.bestBall),
        iterations: 900,
        seed: 7,
        dynasty: loaded.isDynasty
          ? { valueByTeam, valueDelta: bestValueDelta }
          : undefined,
      });
      ideas.push({
        ...best,
        fitScore: round1(fitScore),
        impact,
        impactLabel: primaryImpactText(impact, myClass, loaded.isDynasty),
        impactRank: impactScore(impact, myClass, loaded.isDynasty),
      });
    }
  }

  ideas.sort((a, b) => b.impactRank - a.impactRank || b.fairness - a.fairness);
  // The order is the team's class talking: say so on the idea it put first.
  if (book.on("class-tiebreak") && ideas.length > 1) {
    ideas[0] = { ...ideas[0]!, ruleNote: book.why("class-tiebreak") };
  }
  for (const idea of ideas) {
    if (idea.ruleNote) continue;
    if (book.on("stream-k-def") && [...idea.iGet, ...idea.iGive].some((a) => isStreamPosition(a.position))) {
      idea.ruleNote = book.why("stream-k-def");
    }
  }

  return { ...base, teamClass: myClass, hasMyTeam: true, myTeamName: mine.name, ideas };
}
