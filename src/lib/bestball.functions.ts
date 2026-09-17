/** Best ball tournament import and reading, for the browser. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const fileInput = z.object({
  csv: z.string().min(10).max(8_000_000),
  site: z.string().optional().nullable(),
});

/** Reads the file and reports what it found, before anything is saved. */
export const previewBestballFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fileInput.parse(d))
  .handler(async ({ data }) => {
    const { parseBestballCsv, groupByTournament } = await import("./fantasy/bestball-parse");
    const { BESTBALL_SITE_LABELS } = await import("./fantasy/bestball");
    const parsed = parseBestballCsv(data.csv, data.site ?? null);
    const tournaments = [...groupByTournament(parsed.entries)].map(([name, list]) => ({
      name,
      entries: list.length,
      players: list.reduce((sum, e) => sum + e.players.length, 0),
    }));
    return {
      site: parsed.site,
      siteLabel: BESTBALL_SITE_LABELS[parsed.site],
      tournaments,
      totalEntries: parsed.entries.length,
      skipped: parsed.skipped,
      unknownColumns: parsed.unknownColumns,
    };
  });

/** Saves the file: one league per tournament, replacing any earlier import. */
export const importBestballFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fileInput.parse(d))
  .handler(async ({ data, context }) => {
    const { parseBestballCsv } = await import("./fantasy/bestball-parse");
    const { importBestball } = await import("./fantasy/bestball.server");
    const parsed = parseBestballCsv(data.csv, data.site ?? null);
    const tournaments = await importBestball(
      context.supabase,
      context.userId,
      parsed.site,
      parsed.entries,
    );
    return { site: parsed.site, tournaments };
  });

/** Every entry in a tournament with weekly and running scores. Null if it isn't one. */
export const getBestballFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildBestball } = await import("./fantasy/bestball.server");
    return await buildBestball(context.supabase, context.userId, data.leagueId);
  });

/** Best ball players for the Games view and cross-league exposure. */
export const getBestballExposureFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { bestballExposure } = await import("./fantasy/bestball.server");
    return await bestballExposure(context.supabase);
  });
