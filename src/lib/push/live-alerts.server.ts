/**
 * Game-day pushes built on the existing scoring pipeline: scoring plays by my
 * starters, red-zone trips for their NFL team, and matchup lead changes.
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { buildGameDay } from "@/lib/fantasy/live.server";
import { lastDetail, loadPrefs, notifyUser, type PrefKey } from "./notify.server";

type DB = SupabaseClient<Database>;

export interface RedZoneTeam {
  /** NFL team abbreviation with the ball inside the 20. */
  team: string;
  opponent: string | null;
}

/** Sends scoring-play, red-zone and lead-change pushes for every member. */
export async function sendLiveAlerts(
  admin: DB,
  opts: { season: number; week: number; redZone?: RedZoneTeam[] } = { season: 0, week: 0 },
): Promise<{ scoring: number; redZone: number; leadChange: number }> {
  const { data: leagueRows } = await admin.from("leagues").select("user_id");
  const userIds = [...new Set((leagueRows ?? []).map((l) => l.user_id))];
  if (!userIds.length) return { scoring: 0, redZone: 0, leadChange: 0 };

  const prefs = await loadPrefs(admin, userIds);
  const counts = { scoring: 0, redZone: 0, leadChange: 0 };

  for (const userId of userIds) {
    const wants = prefs.get(userId)!;
    if (!wants.scoring_plays && !wants.red_zone && !wants.lead_change) continue;

    const scoped = scopedClient(admin, userId);
    const day = await buildGameDay(scoped);

    for (const matchup of day.matchups) {
      const matchupRef = `${matchup.leagueId}:${matchup.week}`;

      // ---- lead change
      if (wants.lead_change && matchup.gameState !== "pre") {
        const leader =
          matchup.myScore === matchup.oppScore
            ? "tie"
            : matchup.myScore > matchup.oppScore
              ? "me"
              : "them";
        const previous = await lastDetail(admin, userId, "lead_change", matchupRef);
        if (leader !== "tie" && previous && previous !== leader) {
          const ok = await notifyUser(admin, userId, wants, {
            kind: "lead_change",
            title: matchup.leagueName,
            body:
              leader === "me"
                ? `You just took the lead ${matchup.myScore.toFixed(1)}–${matchup.oppScore.toFixed(1)}`
                : `${matchup.oppTeam ?? "Your opponent"} just took the lead ${matchup.oppScore.toFixed(1)}–${matchup.myScore.toFixed(1)}`,
            url: `/league/${matchup.leagueId}?tab=live`,
            tag: `lead-${matchupRef}`,
            ref: matchupRef,
            detail: leader,
          });
          if (ok) counts.leadChange += 1;
        } else if (leader !== "tie" && !previous) {
          await notifyUser(admin, userId, wants, {
            kind: "lead_change",
            title: matchup.leagueName,
            body: leader === "me" ? "You're ahead" : `${matchup.oppTeam ?? "Your opponent"} is ahead`,
            url: `/league/${matchup.leagueId}?tab=live`,
            ref: matchupRef,
            detail: leader,
            dedupeKey: `lead-first:${matchupRef}`,
          });
        }
      }

      // ---- red zone for my starters
      if (wants.red_zone && opts.redZone?.length) {
        const zones = new Map(opts.redZone.map((z) => [z.team.toUpperCase(), z]));
        for (const player of matchup.starters) {
          const zone = player.nflTeam ? zones.get(player.nflTeam.toUpperCase()) : undefined;
          if (!zone) continue;
          const ok = await notifyUser(admin, userId, wants, {
            kind: "red_zone",
            title: matchup.leagueName,
            body: `${player.name} is in the red zone vs ${zone.opponent ?? "their opponent"}`,
            url: `/league/${matchup.leagueId}?tab=live`,
            tag: `rz-${player.name}`,
            dedupeKey: `rz:${day.week}:${player.name}:${Math.floor(Date.now() / 600_000)}`,
            ref: matchupRef,
          });
          if (ok) counts.redZone += 1;
        }
      }
    }

    // ---- scoring plays by my starters
    if (wants.scoring_plays) {
      const mine = new Set(
        day.matchups.flatMap((m) => m.starters.map((p) => p.name)),
      );
      const recent = day.events.filter(
        (e) => mine.has(e.playerName) && Date.now() - new Date(e.occurredAt).getTime() < 10 * 60_000,
      );
      for (const event of recent.slice(0, 8)) {
        const ok = await notifyUser(admin, userId, wants, {
          kind: "scoring_plays",
          title: `${event.playerName} · ${event.points >= 0 ? "+" : ""}${event.points.toFixed(1)} pts`,
          body: event.description,
          url: "/gameday",
          tag: `score-${event.playerName}`,
          dedupeKey: `score:${event.id}`,
        });
        if (ok) counts.scoring += 1;
      }
    }
  }

  return counts;
}

/**
 * buildGameDay reads whatever rows the client can see, so scope the admin
 * client's reads to one member by filtering on user_id.
 */
function scopedClient(admin: DB, userId: string): DB {
  const proxy = new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table as never);
          const scopable = [
            "leagues",
            "teams",
            "roster_spots",
            "matchups",
            "weekly_snapshots",
          ];
          if (!scopable.includes(table)) return builder;
          const original = builder.select.bind(builder);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (builder as any).select = (...args: unknown[]) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (original as any)(...args).eq("user_id", userId);
          return builder;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return proxy as DB;
}

export type { PrefKey };
