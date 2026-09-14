import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

// ---------------------------------------------------------------- ESPN

export const previewEspnLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().min(2).max(30),
        season: z.number().int().min(2015).max(2100),
        swid: z.string().max(120).optional(),
        espnS2: z.string().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { espnLeagueBundle } = await import("./fantasy/espn.server");
    const bundle = await espnLeagueBundle(data.leagueId, data.season, {
      swid: data.swid ?? null,
      espnS2: data.espnS2 ?? null,
    });

    if (data.swid && data.espnS2) {
      await context.supabase.from("platform_credentials").upsert(
        {
          user_id: context.userId,
          platform: "espn",
          payload: { swid: data.swid, espn_s2: data.espnS2 },
        },
        { onConflict: "user_id,platform" },
      );
    }

    return {
      name: bundle.name,
      season: bundle.season,
      currentWeek: bundle.currentWeek,
      teams: bundle.teams.map((t) => ({
        externalId: t.externalId,
        name: t.name,
        ownerName: t.ownerName,
        record: t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`,
      })),
    };
  });

export const importEspnLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().min(2).max(30),
        season: z.number().int().min(2015).max(2100),
        myTeamExternalId: z.string().min(1).max(30),
        swid: z.string().max(120).optional(),
        espnS2: z.string().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { espnLeagueBundle } = await import("./fantasy/espn.server");
    const { persistBundle } = await import("./fantasy/persist.server");

    let swid = data.swid ?? null;
    let espnS2 = data.espnS2 ?? null;
    if (!swid || !espnS2) {
      const { data: cred } = await context.supabase
        .from("platform_credentials")
        .select("payload")
        .eq("platform", "espn")
        .maybeSingle();
      const payload = (cred?.payload ?? {}) as Record<string, string>;
      swid = swid ?? payload["swid"] ?? null;
      espnS2 = espnS2 ?? payload["espn_s2"] ?? null;
    }

    const bundle = await espnLeagueBundle(data.leagueId, data.season, { swid, espnS2 });
    const saved = await persistBundle(
      context.supabase,
      context.userId,
      { ...bundle, platform: "espn" },
      data.myTeamExternalId,
    );
    return { leagueId: saved.leagueId, name: saved.name };
  });

// ---------------------------------------------------------------- Yahoo

export const yahooStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { yahooConfigured, YAHOO_NOT_CONFIGURED } = await import("./fantasy/yahoo.server");
    void YAHOO_NOT_CONFIGURED;
    const { data } = await context.supabase
      .from("platform_credentials")
      .select("expires_at, payload")
      .eq("platform", "yahoo")
      .maybeSingle();
    const payload = (data?.payload ?? {}) as Record<string, unknown>;
    return {
      configured: yahooConfigured(),
      connected: Boolean(payload["refresh_token"]),
    };
  });

export const startYahooSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { yahooAuthorizeUrl, yahooConfigured, YAHOO_NOT_CONFIGURED } = await import(
      "./fantasy/yahoo.server"
    );
    if (!yahooConfigured()) throw new Error(YAHOO_NOT_CONFIGURED);
    const state = crypto.randomUUID();
    const { error } = await context.supabase.from("platform_credentials").upsert(
      {
        user_id: context.userId,
        platform: "yahoo_pending",
        payload: { state, origin: data.origin },
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      { onConflict: "user_id,platform" },
    );
    if (error) throw new Error(error.message);
    return { url: yahooAuthorizeUrl(data.origin, state) };
  });

async function yahooAccessToken(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { yahooRefresh } = await import("./fantasy/yahoo.server");
  const { data } = await supabase
    .from("platform_credentials")
    .select("payload, expires_at")
    .eq("platform", "yahoo")
    .maybeSingle();
  const payload = (data?.payload ?? {}) as Record<string, string>;
  if (!payload["refresh_token"]) throw new Error("Connect your Yahoo account first.");

  const expiresAt = data?.expires_at ? Date.parse(data.expires_at) : 0;
  if (payload["access_token"] && expiresAt > Date.now()) return payload["access_token"];

  const tokens = await yahooRefresh(payload["refresh_token"]);
  await supabase.from("platform_credentials").upsert(
    {
      user_id: userId,
      platform: "yahoo",
      payload: { access_token: tokens.accessToken, refresh_token: tokens.refreshToken },
      expires_at: new Date(tokens.expiresAt).toISOString(),
    },
    { onConflict: "user_id,platform" },
  );
  return tokens.accessToken;
}

export const listYahooLeagues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { yahooLeagues } = await import("./fantasy/yahoo.server");
    const token = await yahooAccessToken(context.supabase, context.userId);
    return yahooLeagues(token);
  });

export const importYahooLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueKey: z.string().min(3).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { yahooLeagueBundle } = await import("./fantasy/yahoo.server");
    const { persistBundle } = await import("./fantasy/persist.server");
    const token = await yahooAccessToken(context.supabase, context.userId);
    const bundle = await yahooLeagueBundle(data.leagueKey, token);
    const saved = await persistBundle(
      context.supabase,
      context.userId,
      { ...bundle, platform: "yahoo" },
      bundle.teams.find((t) => t.isMine)?.externalId ?? null,
    );
    return { leagueId: saved.leagueId, name: saved.name };
  });

// ---------------------------------------------------------------- trade history

export const logTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        partnerTeamName: z.string().max(80).nullish(),
        gave: z.array(z.object({ name: z.string(), position: z.string(), proj: z.number() })).max(6),
        got: z.array(z.object({ name: z.string(), position: z.string(), proj: z.number() })).max(6),
        pointsDelta: z.number(),
        titleOddsBefore: z.number(),
        titleOddsAfter: z.number(),
        playoffOddsBefore: z.number(),
        playoffOddsAfter: z.number(),
        winsBefore: z.number(),
        winsAfter: z.number(),
        verdict: z.string().max(20),
        status: z.enum(["proposed", "accepted", "declined"]).default("proposed"),
        note: z.string().max(300).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: league } = await context.supabase
      .from("leagues")
      .select("current_week")
      .eq("id", data.leagueId)
      .maybeSingle();
    const { data: myTeam } = await context.supabase
      .from("teams")
      .select("id")
      .eq("league_id", data.leagueId)
      .eq("is_mine", true)
      .maybeSingle();

    const { error } = await context.supabase.from("trade_history").insert({
      user_id: context.userId,
      league_id: data.leagueId,
      team_id: myTeam?.id ?? null,
      week: league?.current_week ?? 1,
      partner_team_name: data.partnerTeamName ?? null,
      gave: data.gave,
      got: data.got,
      points_delta: data.pointsDelta,
      title_odds_before: data.titleOddsBefore,
      title_odds_after: data.titleOddsAfter,
      playoff_odds_before: data.playoffOddsBefore,
      playoff_odds_after: data.playoffOddsAfter,
      wins_before: data.winsBefore,
      wins_after: data.winsAfter,
      verdict: data.verdict,
      status: data.status,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTradeHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid().nullish() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("trade_history")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.leagueId) query = query.eq("league_id", data.leagueId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const { data: leagues } = await context.supabase.from("leagues").select("id, name, platform");
    const leagueById = new Map((leagues ?? []).map((l) => [l.id, l]));

    return (rows ?? []).map((r) => ({
      id: r.id,
      leagueId: r.league_id,
      leagueName: leagueById.get(r.league_id)?.name ?? "League",
      platform: leagueById.get(r.league_id)?.platform ?? "manual",
      week: r.week,
      partnerTeamName: r.partner_team_name,
      gave: (r.gave ?? []) as { name: string; position: string; proj: number }[],
      got: (r.got ?? []) as { name: string; position: string; proj: number }[],
      pointsDelta: Number(r.points_delta),
      titleOddsBefore: Number(r.title_odds_before),
      titleOddsAfter: Number(r.title_odds_after),
      playoffOddsBefore: Number(r.playoff_odds_before),
      playoffOddsAfter: Number(r.playoff_odds_after),
      winsBefore: Number(r.wins_before),
      winsAfter: Number(r.wins_after),
      verdict: r.verdict,
      status: r.status,
      note: r.note,
      createdAt: r.created_at,
    }));
  });

export const updateTradeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["proposed", "accepted", "declined"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trade_history")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trade_history").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
