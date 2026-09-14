import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { CacheStatus } from "@/components/CacheStatus";
import { Button } from "@/components/ui/button";
import { useCachedQuery } from "@/hooks/useCachedQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { getGameDayFn } from "@/lib/fantasy.functions";
import type { LiveGame, LiveMatchup, LivePlayerRow } from "@/lib/fantasy/live-types";
import { pollInterval } from "@/lib/fantasy/gamewindow";
import { leagueColor } from "@/lib/league-colors";

export const Route = createFileRoute("/_authenticated/games")({
  head: () => ({
    meta: [
      { title: "Games — Gridiron Edge" },
      {
        name: "description",
        content:
          "Today's NFL games in kickoff order with live scores, plus every one of your fantasy players and the ones your opponents are starting against you.",
      },
      { property: "og:title", content: "Games — Gridiron Edge" },
      {
        property: "og:description",
        content: "Every NFL game today, with your players and your opponents' players under it.",
      },
    ],
  }),
  component: GamesPage,
});

interface GamePlayer {
  key: string;
  name: string;
  position: string;
  livePoints: number;
  gameState: LivePlayerRow["gameState"];
  isStarter: boolean;
  against: boolean;
  leagueId: string;
  leagueName: string;
  color: string | null;
}

const ALIAS: Record<string, string> = { WSH: "WAS" };
const teamKey = (team: string | null | undefined) =>
  team ? (ALIAS[team.toUpperCase()] ?? team.toUpperCase()) : "";

function collectPlayers(matchups: LiveMatchup[]): Map<string, GamePlayer[]> {
  const byTeam = new Map<string, GamePlayer[]>();
  const add = (matchup: LiveMatchup, row: LivePlayerRow, against: boolean) => {
    const team = teamKey(row.nflTeam);
    if (!team) return;
    const list = byTeam.get(team) ?? [];
    list.push({
      key: `${matchup.leagueId}:${against ? "vs" : "me"}:${row.name}`,
      name: row.name,
      position: row.position,
      livePoints: row.livePoints,
      gameState: row.gameState,
      isStarter: row.isStarter,
      against,
      leagueId: matchup.leagueId,
      leagueName: matchup.leagueName,
      color: matchup.color,
    });
    byTeam.set(team, list);
  };

  for (const matchup of matchups) {
    for (const row of matchup.starters) add(matchup, row, false);
    for (const row of matchup.bench) add(matchup, row, false);
    for (const row of matchup.oppStarters) add(matchup, row, true);
    for (const row of matchup.oppBench) add(matchup, row, true);
  }

  for (const list of byTeam.values()) {
    list.sort(
      (a, b) =>
        Number(a.against) - Number(b.against) ||
        Number(b.isStarter) - Number(a.isStarter) ||
        b.livePoints - a.livePoints,
    );
  }
  return byTeam;
}

const kickoffTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso)) + " ET"
    : "Time to come";

const stateRank = (state: LiveGame["gameState"]) => ({ in: 0, pre: 1, post: 2 })[state];

function GamesPage() {
  const fetchGameDay = useServerFn(getGameDayFn);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["gameday", "games"],
    queryFn: () => fetchGameDay({ data: { games: true } }),
    refetchInterval: pollInterval() || false,
  });

  const playersByTeam = useMemo(() => collectPlayers(data?.matchups ?? []), [data?.matchups]);

  const games = useMemo(() => {
    const all = data?.games ?? [];
    const today = all.filter((g) => g.today);
    return today.length ? today : all;
  }, [data?.games]);

  const showingWholeWeek = !!data?.games.length && !data.games.some((g) => g.today);

  const groups = useMemo(() => {
    const out: { window: string; games: LiveGame[] }[] = [];
    for (const game of games) {
      const existing = out.find((g) => g.window === game.window);
      if (existing) existing.games.push(game);
      else out.push({ window: game.window, games: [game] });
    }
    for (const group of out) group.games.sort((a, b) => stateRank(a.gameState) - stateRank(b.gameState));
    out.sort(
      (a, b) =>
        Math.min(...a.games.map((g) => stateRank(g.gameState))) -
        Math.min(...b.games.map((g) => stateRank(g.gameState))),
    );
    return out;
  }, [games]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Games</h1>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {showingWholeWeek && (
        <p className="mt-1 text-sm text-muted-foreground">
          No games today — here's the rest of week {data?.week}.
        </p>
      )}

      {isLoading && <Skeleton className="mt-6 h-72 w-full rounded-xl" />}

      {!isLoading && !groups.length && (
        <p className="mt-6 text-sm text-muted-foreground">
          No games are scheduled right now. Check back on game day.
        </p>
      )}

      <div className="mt-6 space-y-8">
        {groups.map((group) => (
          <section key={group.window}>
            <h2 className="text-sm font-semibold text-muted-foreground">{group.window}</h2>
            <div className="mt-3 space-y-3">
              {group.games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  players={[
                    ...(playersByTeam.get(game.away) ?? []),
                    ...(playersByTeam.get(game.home) ?? []),
                  ]}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function GameCard({ game, players }: { game: LiveGame; players: GamePlayer[] }) {
  const isFinal = game.gameState === "post";
  const isLive = game.gameState === "in";
  const [open, setOpen] = useState(!isFinal);

  const mine = players.filter((p) => !p.against);
  const theirs = players.filter((p) => p.against);

  return (
    <div
      className={`overflow-hidden rounded-xl bg-card ${isLive ? "ring-1 ring-primary/40" : ""} ${
        isFinal ? "opacity-70" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {isLive && <span className="live-dot size-2 rounded-full bg-primary" aria-hidden="true" />}
          <span className="font-display text-lg font-semibold tracking-wide">
            {game.away} <span className="text-muted-foreground">@</span> {game.home}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            {game.gameState === "pre" ? (
              <p className="text-sm text-muted-foreground">{kickoffTime(game.kickoff)}</p>
            ) : (
              <p className="font-display text-xl font-bold tabular-nums">
                {game.awayScore ?? 0} – {game.homeScore ?? 0}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {isFinal ? "Final" : isLive ? (game.gameClock ?? "Live") : `${players.length} of your players`}
            </p>
          </div>
          <ChevronRight
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {!players.length && (
            <p className="p-4 text-sm text-muted-foreground">
              Nobody from your leagues is in this game.
            </p>
          )}
          {!!mine.length && <PlayerRows rows={mine} />}
          {!!theirs.length && (
            <>
              <p className="bg-secondary/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                Against you
              </p>
              <PlayerRows rows={theirs} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerRows({ rows }: { rows: GamePlayer[] }) {
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => (
        <Link
          key={row.key}
          to="/league/$leagueId"
          params={{ leagueId: row.leagueId }}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/40"
        >
          <span
            className="h-8 w-[3px] shrink-0 rounded-full"
            style={{ background: leagueColor(row.color, row.leagueId) }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm ${row.against ? "text-destructive" : "font-medium"}`}>
              {row.name}
              <span className="ml-2 text-xs text-muted-foreground">{row.position}</span>
              {!row.isStarter && (
                <span className="ml-2 text-xs text-muted-foreground">Bench</span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {row.leagueName}
              {row.against ? " · opponent" : ""}
            </p>
          </div>
          <span className="font-display text-sm font-semibold tabular-nums">
            {row.livePoints.toFixed(1)}
          </span>
        </Link>
      ))}
    </div>
  );
}
