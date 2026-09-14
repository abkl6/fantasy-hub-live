/**
 * Draft pick ownership per league: which future picks each team holds, so
 * trade suggestions can include picks on either side.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leagueValueFormat, pickLabel, type PickSlot } from "@/lib/fantasy/trade-value";

export interface TeamPickRow {
  id: string;
  teamId: string;
  teamName: string;
  isMine: boolean;
  season: number;
  round: number;
  slot: PickSlot;
  count: number;
  originalTeamId: string | null;
  originalTeamName: string | null;
  label: string;
  value: number;
}

const SLOTS = ["early", "mid", "late", "unknown"] as const;

export const listDraftPicks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: league }, { data: teams }, { data: picks }] = await Promise.all([
      context.supabase.from("leagues").select("id, season, roster_slots").eq("id", data.leagueId).maybeSingle(),
      context.supabase.from("teams").select("id, name, is_mine").eq("league_id", data.leagueId).order("name"),
      context.supabase.from("team_draft_picks").select("*").eq("league_id", data.leagueId),
    ]);
    if (!league) throw new Error("League not found.");

    const slots = Array.isArray(league.roster_slots) ? league.roster_slots.map(String) : [];
    const format = leagueValueFormat(slots);
    const { data: pickValues } = await context.supabase
      .from("pick_values")
      .select("season, round, slot, value")
      .eq("format", format);
    const valueOf = (season: number, round: number, slot: string) =>
      Number(
        (pickValues ?? []).find((v) => v.season === season && v.round === round && v.slot === slot)?.value ??
          (pickValues ?? []).find((v) => v.season === season && v.round === round)?.value ??
          0,
      );

    const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));
    const rows: TeamPickRow[] = (picks ?? []).map((p) => ({
      id: p.id,
      teamId: p.team_id,
      teamName: teamName.get(p.team_id) ?? "Unknown team",
      isMine: (teams ?? []).find((t) => t.id === p.team_id)?.is_mine ?? false,
      season: p.season,
      round: p.round,
      slot: String(p.slot) as PickSlot,
      count: p.count,
      originalTeamId: p.original_team_id,
      originalTeamName: p.original_team_id ? (teamName.get(p.original_team_id) ?? null) : null,
      label: pickLabel(p.season, p.round, String(p.slot) as PickSlot),
      value: valueOf(p.season, p.round, String(p.slot)),
    }));

    rows.sort((a, b) => a.season - b.season || a.round - b.round || a.teamName.localeCompare(b.teamName));

    return {
      format,
      seasons: [league.season + 1, league.season + 2, league.season + 3],
      teams: (teams ?? []).map((t) => ({ id: t.id, name: t.name, isMine: t.is_mine })),
      picks: rows,
      valuesReady: (pickValues ?? []).length > 0,
    };
  });

/** Gives every team its own picks for the next three years (rounds 1-3). */
export const resetDraftPicks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid(), rounds: z.number().int().min(1).max(5).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: league } = await context.supabase
      .from("leagues")
      .select("id, season")
      .eq("id", data.leagueId)
      .maybeSingle();
    if (!league) throw new Error("League not found.");
    const { data: teams } = await context.supabase.from("teams").select("id").eq("league_id", data.leagueId);

    await context.supabase.from("team_draft_picks").delete().eq("league_id", data.leagueId);

    const rounds = data.rounds ?? 3;
    const rows = (teams ?? []).flatMap((t) =>
      [1, 2, 3].flatMap((offset) =>
        Array.from({ length: rounds }, (_, i) => ({
          user_id: context.userId,
          league_id: data.leagueId,
          team_id: t.id,
          original_team_id: t.id,
          season: league.season + offset,
          round: i + 1,
          slot: "mid",
          count: 1,
        })),
      ),
    );
    if (rows.length) {
      const { error } = await context.supabase.from("team_draft_picks").insert(rows as never);
      if (error) throw new Error(error.message);
    }
    return { inserted: rows.length };
  });

/** Adds, edits or removes a single pick holding (count 0 removes it). */
export const setDraftPick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamId: z.string().uuid(),
        originalTeamId: z.string().uuid().nullable().optional(),
        season: z.number().int().min(2024).max(2040),
        round: z.number().int().min(1).max(7),
        slot: z.enum(SLOTS).default("mid"),
        count: z.number().int().min(0).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const original = data.originalTeamId ?? data.teamId;

    const { data: existing } = await context.supabase
      .from("team_draft_picks")
      .select("id")
      .eq("league_id", data.leagueId)
      .eq("team_id", data.teamId)
      .eq("season", data.season)
      .eq("round", data.round)
      .eq("original_team_id", original)
      .maybeSingle();

    if (data.count === 0) {
      if (existing) await context.supabase.from("team_draft_picks").delete().eq("id", existing.id);
      return { ok: true };
    }

    if (existing) {
      const { error } = await context.supabase
        .from("team_draft_picks")
        .update({ count: data.count, slot: data.slot })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    const { error } = await context.supabase.from("team_draft_picks").insert({
      user_id: context.userId,
      league_id: data.leagueId,
      team_id: data.teamId,
      original_team_id: original,
      season: data.season,
      round: data.round,
      slot: data.slot,
      count: data.count,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
