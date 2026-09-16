/**
 * FFPC connect, import and sync entry points for the browser.
 *
 * The pasted league URL contains a private `ltuid` token. It is read on the
 * server, stored encrypted, and never returned to the browser or written into
 * an error message.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const urlInput = z.object({ url: z.string().min(10).max(500) });

/** Whether this account has an FFPC link saved. */
export const ffpcStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("platform_credentials")
      .select("payload")
      .eq("platform", "ffpc")
      .maybeSingle();
    const payload = (data?.payload ?? {}) as Record<string, unknown>;
    return { connected: Boolean(payload["ltuid"]) };
  });

/** Reads a league's basics so the manager can confirm it before importing. */
export const previewFfpcLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => urlInput.parse(d))
  .handler(async ({ data, context }) => {
    const { parseFfpcUrl } = await import("./fantasy/ffpc-parse");
    const { ffpcLeagueBundle } = await import("./fantasy/ffpc.server");
    const { saveFfpcToken, ffpcToken, recordFfpcFailure } = await import(
      "./fantasy/ffpc-sync.server"
    );
    const { CONTEST_LABELS } = await import("./fantasy/contest");

    const parsed = parseFfpcUrl(data.url);
    if (!parsed) {
      throw new Error("That doesn't look like an FFPC league link. Copy the address from your league page.");
    }

    const ltuid = parsed.ltuid ?? (await ffpcToken(context.supabase));
    if (!ltuid) {
      throw new Error("That link is missing its access token. Copy the full address from your league page.");
    }

    try {
      const bundle = await ffpcLeagueBundle(parsed.leagueId, ltuid, { shallow: true });
      await saveFfpcToken(context.supabase, context.userId, ltuid);
      return {
        leagueId: bundle.externalId,
        name: bundle.name,
        leagueType: bundle.leagueType,
        season: bundle.season,
        currentWeek: bundle.currentWeek,
        contestFormat: bundle.contestFormat,
        contestLabel: CONTEST_LABELS[bundle.contestFormat],
        allPlayWeeks: bundle.allPlayWeeks,
        myTeamExternalId: bundle.myTeamExternalId,
        teams: bundle.teams.map((t) => ({
          externalId: t.externalId,
          name: t.name,
          record: t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`,
          pointsFor: t.pointsFor,
          vp: t.vp,
        })),
      };
    } catch (error) {
      await recordFfpcFailure(context.supabase, context.userId, null, error);
      throw new Error(
        error instanceof Error ? error.message : "FFPC could not be read right now.",
      );
    }
  });

/** Imports the league in full and points it at my team. */
export const importFfpcLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().min(1).max(40),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { ffpcLeagueBundle } = await import("./fantasy/ffpc.server");
    const { persistBundle } = await import("./fantasy/persist.server");
    const { detectLeagueType } = await import("./fantasy/league-type");
    const { ffpcToken, applyFfpcBundle, recordFfpcFailure } = await import(
      "./fantasy/ffpc-sync.server"
    );

    const ltuid = await ffpcToken(context.supabase);
    if (!ltuid) throw new Error("Connect FFPC first by pasting a league link.");

    try {
      const bundle = await ffpcLeagueBundle(data.leagueId, ltuid);
      const mine = bundle.myTeamExternalId;
      if (!mine) throw new Error("FFPC did not identify your team from the league page.");
      const saved = await persistBundle(
        context.supabase,
        context.userId,
        {
          platform: "ffpc",
          externalId: bundle.externalId,
          name: bundle.name,
          season: bundle.season,
          currentWeek: bundle.currentWeek,
          teamCount: bundle.teamCount,
          playoffTeams: bundle.playoffTeams,
          regularSeasonWeeks: bundle.regularSeasonWeeks,
          scoringType: bundle.scoringType,
          scoringRules: bundle.scoringRules,
          rosterSlots: bundle.rosterSlots,
          contestFormat: bundle.contestFormat,
          ...detectLeagueType({
            typeDescription: `${bundle.leagueType} ${bundle.name}`,
            hasEmpirePanel: bundle.hasEmpirePanel,
            hasFuturePicks: bundle.futurePicks.length > 0,
          }),
          teams: bundle.teams,
          schedule: bundle.schedule,
        },
        mine ?? null,
      );
      // Second pass writes the FFPC-only extras (VP, all-play weeks, FAAB,
      // dynasty picks) onto the league persistBundle just created.
      await applyFfpcBundle(context.supabase, context.userId, saved.leagueId, bundle);
      return { leagueId: saved.leagueId, name: saved.name };
    } catch (error) {
      await recordFfpcFailure(context.supabase, context.userId, null, error);
      throw new Error(error instanceof Error ? error.message : "The FFPC import failed.");
    }
  });

/** Manual "try again" for a league whose sync is paused. */
export const syncFfpcLeague = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ leagueId: z.string().uuid(), live: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { refreshFfpcLeague } = await import("./fantasy/ffpc-sync.server");
    return refreshFfpcLeague(context.supabase, context.userId, data.leagueId, {
      ...(data.live === undefined ? {} : { live: data.live }),
    });
  });
