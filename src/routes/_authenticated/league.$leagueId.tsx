import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { DraftPicksPanel } from "@/components/DraftPicksPanel";
import type { TeamBadge as TeamBadgeValue } from "@/lib/fantasy/team-class";
import { TeamBadge } from "@/components/TeamBadge";
import { TradeBuilder } from "@/components/TradeBuilder";
import { GameDayBoard } from "@/components/GameDayBoard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  applyMoveFn,
  evaluateTradeFn,
  getAnalysis,
  getDraftRecapFn,
  getPlayoffPictureFn,
  getTrendsFn,
  getWaiverBoard,
  importSleeperDraftFn,
  setBestLineupFn,
} from "@/lib/fantasy.functions";
import { logTrade } from "@/lib/platforms.functions";

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Active: "default",
  Questionable: "secondary",
  Doubtful: "destructive",
  Out: "destructive",
  IR: "destructive",
};

export const Route = createFileRoute("/_authenticated/league/$leagueId")({
  head: () => ({
    meta: [
      { title: "League analyzer — Gridiron Edge" },
      {
        name: "description",
        content:
          "Live scoreboard, championship odds, position grades and the moves that raise your title chances the most.",
      },
      { property: "og:title", content: "League analyzer — Gridiron Edge" },
      { property: "og:description", content: "Championship odds and ranked moves for your fantasy team." },
    ],
  }),
  component: LeaguePage,
});

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;

function LeaguePage() {
  const { leagueId } = Route.useParams();
  const analyze = useServerFn(getAnalysis);
  const [tab, setTab] = useState("moves");

  const forceRef = useRef(false);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["analysis", leagueId],
    queryFn: () => {
      const force = forceRef.current;
      forceRef.current = false;
      return analyze({ data: { leagueId, force } });
    },
    refetchOnWindowFocus: false,
  });
  const hardRefresh = () => {
    forceRef.current = true;
    return refetch();
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-10">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-bold uppercase">We could not load this league</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Try refreshing in a moment."}
        </p>
        <Button className="mt-4" onClick={() => refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const me = data.myTeam;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-primary">Week {data.league.current_week}</p>
          <h1 className="mt-2 text-4xl font-bold uppercase">{data.league.name}</h1>
          {me && (
            <p className="mt-1 text-sm text-muted-foreground">
              {me.name} · {me.record} · {me.pointsFor.toFixed(1)} points for
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-[10px] uppercase">
              {data.formatLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              {data.scoringLabel}
            </Badge>
          </div>
        </div>
        <Button variant="outline" onClick={() => hardRefresh()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {me && !data.mySurvival && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <OddsCard label="Title odds" value={pct(me.titleOdds)} tone="primary" />
          <OddsCard label="Playoff odds" value={pct(me.playoffOdds)} />
          <OddsCard
            label="Projected finish"
            value={`${me.projWins.toFixed(1)}-${me.projLosses.toFixed(1)}`}
          />
        </div>
      )}

      {me && data.mySurvival && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <OddsCard label="Survive this week" value={pct(data.mySurvival.surviveWeekOdds)} tone="primary" />
          <OddsCard label="Last team standing" value={pct(data.mySurvival.winOdds)} />
          <OddsCard
            label="Weeks you should last"
            value={`${data.mySurvival.expectedWeeksLeft}`}
          />
        </div>
      )}

      {!!data.alerts?.length && (
        <section className="mt-6 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <h2 className="text-sm font-bold uppercase text-destructive">Alerts</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.alerts.map((a) => (
              <div
                key={a.id}
                className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 ${
                  a.severity === "high" ? "border-l-4 border-l-destructive" : ""
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{a.message}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {a.position} · {a.kind}
                  </p>
                </div>
                {a.action && (
                  <Button size="sm" variant="outline" onClick={() => setTab("waivers")}>
                    {a.action.label}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="moves">Moves</TabsTrigger>
          <TabsTrigger value="lineup">Lineup</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="scoreboard">Scoreboard</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="waivers">Waivers</TabsTrigger>
          <TabsTrigger value="trade">Trade</TabsTrigger>
          <TabsTrigger value="playoff">Playoff</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-6">
          <GameDayBoard leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="moves" className="mt-6 space-y-3">
          {!data.suggestions.length && (
            <p className="text-sm text-muted-foreground">
              No moves worth making right now — your lineup is already the strongest one available.
            </p>
          )}
          {data.suggestions.map((s) => (
            <MoveCard key={s.id} leagueId={leagueId} suggestion={s} onApplied={() => refetch()} />
          ))}
        </TabsContent>

        <TabsContent value="lineup" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Starters are based on projected points for this week.
            </p>
            <SetBestLineupButton leagueId={leagueId} onApplied={() => refetch()} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <PlayerList title="Best starting lineup" players={data.lineup} />
            <PlayerList title="Bench" players={data.bench} />
          </div>
        </TabsContent>

        <TabsContent value="grades" className="mt-6 space-y-3">
          {data.grades.map((g) => (
            <div key={g.position} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold uppercase">{g.position}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.myPoints.toFixed(1)} proj pts vs {g.leagueAverage.toFixed(1)} league average
                  </p>
                </div>
                <div className="text-right">
                  <p className="stat-num text-3xl text-primary">{g.grade}</p>
                  <p className="text-xs uppercase text-muted-foreground">{g.verdict}</p>
                </div>
              </div>
              <Progress
                className="mt-3"
                value={Math.max(
                  4,
                  Math.min(100, (g.myPoints / Math.max(g.leagueAverage * 2, 1)) * 100),
                )}
              />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="scoreboard" className="mt-6 space-y-3">
          {!data.scoreboard.length && (
            <p className="text-sm text-muted-foreground">No matchups posted for this week yet.</p>
          )}
          {data.scoreboard.map((m, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-5"
            >
              <TeamScore
                name={m.home.name}
                points={m.home.score}
                winning={m.home.score >= m.away.score}
              />
              <span className="px-4 text-xs uppercase text-muted-foreground">vs</span>
              <TeamScore
                name={m.away.name}
                points={m.away.score}
                winning={m.away.score > m.home.score}
                alignRight
              />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="standings" className="mt-6 overflow-x-auto">
          <StandingsTable leagueId={leagueId} standings={data.standings} />
        </TabsContent>

        <TabsContent value="waivers" className="mt-6">
          <WaiverPanel leagueId={leagueId} onAdded={() => refetch()} />
        </TabsContent>

        <TabsContent value="trade" className="mt-6 space-y-6">
          <TradeBuilder leagueId={leagueId} />
          <TradePanel leagueId={leagueId} />
          <DraftPicksPanel leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="playoff" className="mt-6">
          <PlayoffPanel leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="trends" className="mt-6">
          <TrendsPanel leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="draft" className="mt-6">
          <DraftPanel leagueId={leagueId} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function OddsCard({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className={`stat-num mt-1 text-4xl ${tone === "primary" ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function TeamScore({
  name,
  points,
  winning,
  alignRight,
}: {
  name: string;
  points: number;
  winning: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={alignRight ? "text-right" : ""}>
      <p className="font-semibold">{name}</p>
      <p className={`stat-num text-2xl ${winning ? "text-primary" : "text-muted-foreground"}`}>
        {points.toFixed(1)}
      </p>
    </div>
  );
}

function PlayerList({
  title,
  players,
}: {
  title: string;
  players: { name: string; position: string; slot?: string; proj: number; status?: string; nflTeam?: string | null; byeWeek?: number | null }[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-bold uppercase">{title}</h2>
      <ul className="mt-3 space-y-2">
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="eyebrow text-muted-foreground">{p.slot ?? p.position}</span>
              <span>{p.name}</span>
              {p.status && p.status !== "Active" && (
                <Badge variant={statusTone[p.status] ?? "secondary"} className="text-[10px] uppercase">
                  {p.status}
                </Badge>
              )}
              {p.byeWeek && (
                <Badge variant="outline" className="text-[10px]">
                  bye {p.byeWeek}
                </Badge>
              )}
              {p.nflTeam && <span className="text-xs text-muted-foreground">{p.nflTeam}</span>}
            </span>
            <span className="stat-num">{p.proj.toFixed(1)}</span>
          </li>
        ))}
        {!players.length && <li className="text-sm text-muted-foreground">Nothing here.</li>}
      </ul>
    </section>
  );
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

const SORTS = [
  { id: "impact", label: "Title impact" },
  { id: "points", label: "Points" },
  { id: "bid", label: "Bid" },
  { id: "value", label: "Trade value" },
  { id: "ktc", label: "Market value" },
  { id: "gems", label: "Undervalued" },
] as const;

function WaiverPanel({ leagueId, onAdded }: { leagueId: string; onAdded?: () => void }) {
  const load = useServerFn(getWaiverBoard);
  const add = useServerFn(applyMoveFn);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("impact");

  const { data, isFetching } = useQuery({
    queryKey: ["waivers", leagueId, search, position],
    queryFn: () => load({ data: { leagueId, search, position } }),
    refetchOnWindowFocus: false,
  });

  const addMutation = useMutation({
    mutationFn: (v: { name: string; drop: string | null }) =>
      add({ data: { leagueId, kind: "waiver", addName: v.name, dropName: v.drop } }),
    onSuccess: (_r, v) => {
      toast.success(v.drop ? `Added ${v.name}, dropped ${v.drop}` : `${v.name} added to your bench`);
      queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["waivers", leagueId] });
      onAdded?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add player."),
  });

  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    if (sort === "points") return b.projWeek - a.projWeek;
    if (sort === "bid") return b.bid - a.bid;
    if (sort === "value") return b.tradeValue - a.tradeValue;
    if (sort === "ktc") return (b.ktcValue ?? -1) - (a.ktcValue ?? -1);
    if (sort === "gems")
      return (
        Number(b.undervalued) - Number(a.undervalued) ||
        b.projValue - (b.ktcValue ?? b.projValue) - (a.projValue - (a.ktcValue ?? a.projValue))
      );
    return (b.titleDelta ?? -1) - (a.titleDelta ?? -1) || b.tradeValue - a.tradeValue;
  });

  const rosterFull = !!data && data.rosterSize >= data.rosterLimit;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold uppercase">Waiver wire</h2>
          <p className="text-xs text-muted-foreground">
            Everyone still unowned in this league, with what they are worth and what they do to your
            title chances.
          </p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a player"
          className="w-full sm:w-64"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {POSITIONS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={position === p ? "default" : "outline"}
            onClick={() => setPosition(p)}
          >
            {p}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="eyebrow text-muted-foreground">Sort by</span>
        {SORTS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={sort === s.id ? "secondary" : "ghost"}
            onClick={() => setSort(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {data && (
        <p className="mt-3 text-xs text-muted-foreground">
          {data.hasMyTeam
            ? `Roster ${data.rosterSize} of ${data.rosterLimit}.${rosterFull ? " Full — an add will drop the suggested player." : ""}`
            : "Mark one team as yours to see title impact and bids."}
          {data.estimatedRosterSpots
            ? " Some rival rosters are estimated, so this list is approximate."
            : ""}
        </p>
      )}

      <ul className="mt-4 space-y-1">
        {isFetching && !data && <li className="text-sm text-muted-foreground">Loading…</li>}
        {rows.map((p) => (
          <li key={p.id} className="border-t border-border py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="eyebrow text-muted-foreground">{p.position}</span>
                  <span className="font-medium">{p.name}</span>
                  {p.undervalued && (
                    <Badge className="text-[10px] uppercase">Undervalued</Badge>
                  )}
                  {p.status && p.status !== "Active" && (
                    <Badge variant={statusTone[p.status] ?? "secondary"} className="text-[10px] uppercase">
                      {p.status}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {p.nflTeam ?? "FA"}
                    {p.byeWeek ? ` · bye ${p.byeWeek}` : ""}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="stat-num text-foreground">{p.projWeek.toFixed(1)}</span> pts/wk ·{" "}
                    <span className="stat-num text-foreground">{p.projSeason.toFixed(0)}</span> season
                  </span>
                  <span>
                    Trade value{" "}
                    <span className={`stat-num ${p.tradeValue > 0 ? "text-foreground" : ""}`}>
                      {p.tradeValue > 0 ? "+" : ""}
                      {p.tradeValue.toFixed(1)}
                    </span>
                  </span>
                  <span>
                    Bid <span className="stat-num text-foreground">{p.bid > 0 ? `${p.bid}%` : "no bid"}</span>
                  </span>
                  {p.longTermValue !== null && (
                    <span>
                      Keep value{" "}
                      <span className="stat-num text-foreground">{p.longTermValue.toFixed(0)}</span>/100
                    </span>
                  )}
                  {p.titleDelta !== null && (
                    <span className={p.titleDelta > 0 ? "text-primary" : ""}>
                      Title {p.titleDelta > 0 ? "+" : ""}
                      {(p.titleDelta * 100).toFixed(1)} pts · playoffs {(p.playoffDelta ?? 0) > 0 ? "+" : ""}
                      {((p.playoffDelta ?? 0) * 100).toFixed(1)}
                    </span>
                  )}
                  {p.suggestedDrop && <span>Drop {p.suggestedDrop}</span>}
                </div>
              </div>
              <Button
                size="sm"
                variant={p.titleDelta && p.titleDelta > 0 ? "default" : "outline"}
                disabled={addMutation.isPending && addMutation.variables?.name === p.name}
                onClick={() => {
                  if (rosterFull && !p.suggestedDrop) {
                    toast.error("Your roster is full. Drop someone on the Lineup tab first.");
                    return;
                  }
                  addMutation.mutate({ name: p.name, drop: p.suggestedDrop });
                }}
              >
                {addMutation.isPending && addMutation.variables?.name === p.name ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  "Add"
                )}
              </Button>
            </div>
          </li>
        ))}
        {data && !rows.length && (
          <li className="text-sm text-muted-foreground">No available players match that.</li>
        )}
      </ul>
    </section>
  );
}

function TradePanel({ leagueId }: { leagueId: string }) {
  const evaluate = useServerFn(evaluateTradeFn);
  const save = useServerFn(logTrade);
  const [give, setGive] = useState("");
  const [get, setGet] = useState("");
  const [saved, setSaved] = useState(false);

  const run = useMutation({
    mutationFn: () =>
      evaluate({
        data: {
          leagueId,
          giveNames: give.split(",").map((s) => s.trim()).filter(Boolean),
          getNames: get.split(",").map((s) => s.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => setSaved(false),
  });

  const store = useMutation({
    mutationFn: (status: "proposed" | "accepted") => {
      const r = run.data!;
      return save({
        data: {
          leagueId,
          gave: give
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({ name, position: "-", proj: 0 })),
          got: r.incoming,
          pointsDelta: r.pointsDelta,
          titleOddsBefore: r.beforeTitleOdds,
          titleOddsAfter: r.afterTitleOdds,
          playoffOddsBefore: r.beforePlayoffOdds,
          playoffOddsAfter: r.afterPlayoffOdds,
          winsBefore: r.beforeWins,
          winsAfter: r.afterWins,
          verdict: r.verdict,
          status,
        },
      });
    },
    onSuccess: () => {
      setSaved(true);
      toast.success("Saved to your trade history.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that trade."),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-2xl font-bold uppercase">Evaluate a trade</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the players on each side and we will re-run the rest of the season to see what it does
        to your title odds.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="give">You give</Label>
          <Input id="give" value={give} onChange={(e) => setGive(e.target.value)} placeholder="Player, Player" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="get">You get</Label>
          <Input id="get" value={get} onChange={(e) => setGet(e.target.value)} placeholder="Player, Player" />
        </div>
      </div>
      <Button className="mt-5" disabled={run.isPending || !give || !get} onClick={() => run.mutate()}>
        {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        Check this trade
      </Button>

      {run.error && (
        <p className="mt-4 text-sm text-destructive">
          {run.error instanceof Error ? run.error.message : "Could not evaluate that trade."}
        </p>
      )}

      {run.data && (
        <div className="mt-6 rounded-lg border border-border bg-background/50 p-5">
          <Badge
            className="uppercase"
            variant={run.data.verdict === "accept" ? "default" : "secondary"}
          >
            {run.data.verdict}
          </Badge>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Title odds"
              before={pct(run.data.beforeTitleOdds)}
              after={pct(run.data.afterTitleOdds)}
            />
            <Stat
              label="Playoff odds"
              before={pct(run.data.beforePlayoffOdds)}
              after={pct(run.data.afterPlayoffOdds)}
            />
            <Stat
              label="Projected wins"
              before={run.data.beforeWins.toFixed(1)}
              after={run.data.afterWins.toFixed(1)}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Weekly points change: {run.data.pointsDelta >= 0 ? "+" : ""}
            {run.data.pointsDelta.toFixed(1)}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={store.isPending || saved} onClick={() => store.mutate("accepted")}>
              {store.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              I made this trade
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={store.isPending || saved}
              onClick={() => store.mutate("proposed")}
            >
              Save as an idea
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const text = `Trade offer: I give ${give || "?"} and get ${get || "?"}. Projected title odds ${pct(run.data.beforeTitleOdds)} → ${pct(run.data.afterTitleOdds)} (${run.data.verdict}).`;
                navigator.clipboard.writeText(text).then(() => toast.success("Trade text copied"));
              }}
            >
              <Copy className="size-4 mr-1" />
              Copy text
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/trades">See trade history</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function StandingsTable({
  leagueId,
  standings,
}: {
  leagueId: string;
  standings: {
    id: string;
    name: string;
    isMine: boolean;
    record: string;
    pointsFor: number;
    playoffOdds: number;
    titleOdds: number;
    badge?: TeamBadgeValue;
  }[];
}) {
  const load = useServerFn(getTrendsFn);
  const { data: trends } = useQuery({
    queryKey: ["trends", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  const teamTrends = new Map(trends?.series?.map((s) => [s.teamId, s.points]) ?? []);

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2">Team</th>
          <th className="py-2">Record</th>
          <th className="py-2">Points</th>
          <th className="py-2">Playoffs</th>
          <th className="py-2">Title</th>
          <th className="py-2">Trend</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((t) => {
          const points = teamTrends.get(t.id) ?? [];
          const start = points[0]?.titleOdds ?? t.titleOdds;
          const end = points[points.length - 1]?.titleOdds ?? t.titleOdds;
          const up = end >= start;
          return (
            <tr key={t.id} className={`border-t border-border ${t.isMine ? "bg-primary/5 font-semibold" : ""}`}>
              <td className="py-3">
                <span className="flex flex-wrap items-center gap-2">
                  {t.name}
                  <TeamBadge badge={t.badge} />
                </span>
              </td>
              <td className="stat-num py-3">{t.record}</td>
              <td className="stat-num py-3">{t.pointsFor.toFixed(1)}</td>
              <td className="stat-num py-3">{pct(t.playoffOdds)}</td>
              <td className="stat-num py-3 text-primary">{pct(t.titleOdds)}</td>
              <td className="py-3">
                {points.length > 1 ? (
                  <div className="flex items-center gap-1">
                    {up ? <ChevronUp className="size-4 text-primary" /> : <ChevronDown className="size-4 text-destructive" />}
                    <MiniSparkline points={points.map((p) => p.titleOdds)} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MiniSparkline({ points }: { points: number[] }) {
  const width = 60;
  const height = 20;
  const max = Math.max(...points, 0.01);
  const min = Math.min(...points, 0);
  const xFor = (i: number) => (i / Math.max(points.length - 1, 1)) * width;
  const yFor = (v: number) => height - ((v - min) / Math.max(max - min, 0.001)) * height;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p)}`).join(" ");
  return (
    <svg width={width} height={height} className="text-primary">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

function MoveCard({
  leagueId,
  suggestion,
  onApplied,
}: {
  leagueId: string;
  suggestion: {
    id: string;
    kind: string;
    headline: string;
    detail: string;
    titleDelta: number;
    playoffDelta: number;
    pointsDelta: number;
    addName?: string;
    dropName?: string;
  };
  onApplied: () => void;
}) {
  const apply = useServerFn(applyMoveFn);
  const mutation = useMutation({
    mutationFn: () =>
      apply({
        data: {
          leagueId,
          kind: suggestion.kind === "waiver_add" ? "waiver" : "start-sit",
          addName: suggestion.addName ?? "",
          dropName: suggestion.dropName,
        },
      }),
    onSuccess: () => {
      toast.success("Move applied");
      onApplied();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not apply move."),
  });

  const canApply =
    (suggestion.kind === "waiver_add" || suggestion.kind === "start_sit") &&
    suggestion.addName;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge variant="secondary" className="uppercase">
            {suggestion.kind.replace(/_/g, " ")}
          </Badge>
          <h3 className="mt-2 text-xl font-semibold">{suggestion.headline}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{suggestion.detail}</p>
        </div>
        <div className="text-right">
          <p className="eyebrow text-muted-foreground">Title odds</p>
          <p
            className={`stat-num text-2xl ${suggestion.titleDelta >= 0 ? "text-primary" : "text-destructive"}`}
          >
            {signed(suggestion.titleDelta)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Playoffs {signed(suggestion.playoffDelta)} · {suggestion.pointsDelta >= 0 ? "+" : ""}
            {suggestion.pointsDelta.toFixed(1)} proj pts
          </p>
        </div>
      </div>
      {canApply && (
        <div className="mt-4">
          <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Apply this move
          </Button>
        </div>
      )}
    </article>
  );
}

function SetBestLineupButton({ leagueId, onApplied }: { leagueId: string; onApplied: () => void }) {
  const setBest = useServerFn(setBestLineupFn);
  const mutation = useMutation({
    mutationFn: () => setBest({ data: { leagueId } }),
    onSuccess: () => {
      toast.success("Best lineup set");
      onApplied();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not set lineup."),
  });

  return (
    <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
      Set best lineup
    </Button>
  );
}

function PlayoffPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getPlayoffPictureFn);
  const { data, isLoading } = useQuery({
    queryKey: ["playoff", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data) return <p className="text-sm text-muted-foreground">Could not load playoff picture.</p>;

  return (
    <div className="space-y-6">
      {data.myScenario && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold uppercase flex items-center gap-2">
            <Trophy className="size-5 text-primary" />
            Your playoff path
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox label="Clinch playoffs" value={`${data.myScenario.clinchPlayoffRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Clinch bye" value={`${data.myScenario.clinchByeRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Elimination risk" value={`${data.myScenario.eliminationRecord?.toFixed(1) ?? "—"} wins`} />
            <StatBox label="Magic number" value={data.myScenario.magicNumberPlayoff?.toFixed(1) ?? "—"} />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold uppercase flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          Projected seeds
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Seed</th>
                <th className="py-2">Team</th>
                <th className="py-2">Proj wins</th>
                <th className="py-2">Playoffs</th>
                <th className="py-2">Title</th>
              </tr>
            </thead>
            <tbody>
              {data.seeds.map((s) => (
                <tr key={s.teamId} className={`border-t border-border ${s.isMine ? "bg-primary/5 font-semibold" : ""}`}>
                  <td className="py-3">{s.seed}</td>
                  <td className="py-3">{s.name}</td>
                  <td className="stat-num py-3">{s.projWins.toFixed(1)}</td>
                  <td className="stat-num py-3">{pct(s.playoffOdds)}</td>
                  <td className="stat-num py-3 text-primary">{pct(s.titleOdds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!!data.rootingInterests?.length && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold uppercase flex items-center gap-2">
            <Users className="size-5 text-primary" />
            Rooting interests
          </h2>
          <ul className="mt-4 space-y-2">
            {data.rootingInterests.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">
                  {r.rootFor === "home" ? r.homeName : r.rootFor === "away" ? r.awayName : "Either side"}
                </span>
                <span className="text-muted-foreground"> — {r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-4">
      <p className="eyebrow text-xs text-muted-foreground">{label}</p>
      <p className="stat-num mt-1 text-xl">{value}</p>
    </div>
  );
}

function TrendsPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getTrendsFn);
  const { data, isLoading } = useQuery({
    queryKey: ["trends", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!data?.series?.length) return <p className="text-sm text-muted-foreground">No trend data yet. Snapshots are saved each time you refresh the league page.</p>;

  const width = 600;
  const height = 240;
  const padding = 40;
  const allOdds = data.series.flatMap((s) => s.points.map((p) => p.titleOdds));
  const maxOdds = Math.max(...allOdds, 0.01);
  const minWeek = Math.min(...data.weeks);
  const maxWeek = Math.max(...data.weeks);

  const xFor = (week: number) =>
    padding + ((week - minWeek) / Math.max(maxWeek - minWeek, 1)) * (width - padding * 2);
  const yFor = (odds: number) => height - padding - (odds / maxOdds) * (height - padding * 2);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-bold uppercase">Title odds over time</h2>
      <p className="text-xs text-muted-foreground">Tracked each week when you load this league.</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full">
        {data.weeks.map((w) => (
          <line
            key={w}
            x1={xFor(w)}
            y1={padding}
            x2={xFor(w)}
            y2={height - padding}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="2 2"
          />
        ))}
        <text x={padding} y={height - 10} className="text-[10px] fill-muted-foreground">
          Week {minWeek}
        </text>
        <text x={width - padding - 30} y={height - 10} className="text-[10px] fill-muted-foreground">
          Week {maxWeek}
        </text>
        {data.series.map((s, i) => {
          const d = s.points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${xFor(p.week)} ${yFor(p.titleOdds)}`).join(" ");
          const colors = ["text-primary", "text-chart-2", "text-chart-3", "text-chart-4", "text-chart-5"];
          const color = colors[i % colors.length];
          return (
            <g key={s.teamId}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={s.isMine ? 3 : 2} className={color} />
              {s.points.map((p) => (
                <circle key={p.week} cx={xFor(p.week)} cy={yFor(p.titleOdds)} r={s.isMine ? 4 : 3} className={`fill-current ${color}`} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-3">
        {data.series.map((s, i) => {
          const start = s.points[0]?.titleOdds ?? 0;
          const end = s.points[s.points.length - 1]?.titleOdds ?? 0;
          const up = end >= start;
          return (
            <div key={s.teamId} className="flex items-center gap-2 text-sm">
              <span className={`inline-block size-2 rounded-full ${up ? "bg-primary" : "bg-destructive"}`} />
              <span className={s.isMine ? "font-semibold" : ""}>{s.name}</span>
              {up ? <ChevronUp className="size-3 text-primary" /> : <ChevronDown className="size-3 text-destructive" />}
              <span className="text-xs text-muted-foreground">{pct(end)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DraftPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getDraftRecapFn);
  const importDraft = useServerFn(importSleeperDraftFn);
  const [sleeperId, setSleeperId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["draft", leagueId],
    queryFn: () => load({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });
  const importMutation = useMutation({
    mutationFn: () => importDraft({ data: { leagueId, sleeperLeagueId: sleeperId } }),
    onSuccess: () => {
      toast.success("Draft imported");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not import draft."),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-6">
      {!data?.picks?.length && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold uppercase">Import draft results</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For Sleeper leagues, paste the Sleeper league ID to pull the full draft board.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Input
              value={sleeperId}
              onChange={(e) => setSleeperId(e.target.value)}
              placeholder="Sleeper league ID"
              className="w-full sm:w-64"
            />
            <Button disabled={!sleeperId || importMutation.isPending} onClick={() => importMutation.mutate()}>
              {importMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Import"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            For other platforms, upload a screenshot of your draft board on the Connect page and it will be graded here.
          </p>
        </section>
      )}

      {!!data?.grades?.length && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold uppercase">Draft grades</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.grades.map((g) => (
              <div key={g.teamId} className={`rounded-lg border border-border p-4 ${g.isMine ? "bg-primary/5" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className={`font-semibold ${g.isMine ? "text-primary" : ""}`}>{g.teamName}</p>
                  <p className="stat-num text-2xl">{g.grade}</p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Best: {g.bestPick.player_name} · Worst: {g.worstPick.player_name}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!data?.picks?.length && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold uppercase">Draft board</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Pick</th>
                  <th className="py-2">Team</th>
                  <th className="py-2">Player</th>
                  <th className="py-2">Pos</th>
                  <th className="py-2">Proj</th>
                </tr>
              </thead>
              <tbody>
                {data.picks.map((p) => (
                  <tr key={p.pick_number} className={`border-t border-border ${p.isMine ? "bg-primary/5 font-semibold" : ""}`}>
                    <td className="py-2">{p.pick_number}</td>
                    <td className="py-2">{p.teamName}</td>
                    <td className="py-2">{p.player_name}</td>
                    <td className="py-2">{p.position}</td>
                    <td className="stat-num py-2">{Number(p.proj_points_season).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="stat-num mt-1 text-xl">
        <span className="text-muted-foreground">{before}</span>
        <span className="mx-2 text-muted-foreground">→</span>
        <span className="text-primary">{after}</span>
      </p>
    </div>
  );
}
