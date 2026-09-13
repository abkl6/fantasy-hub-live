import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { evaluateTradeFn, getAnalysis, getWaiverWire } from "@/lib/fantasy.functions";
import { logTrade } from "@/lib/platforms.functions";

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

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["analysis", leagueId],
    queryFn: () => analyze({ data: { leagueId } }),
    refetchOnWindowFocus: false,
  });

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
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {me && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <OddsCard label="Title odds" value={pct(me.titleOdds)} tone="primary" />
          <OddsCard label="Playoff odds" value={pct(me.playoffOdds)} />
          <OddsCard
            label="Projected finish"
            value={`${me.projWins.toFixed(1)}-${me.projLosses.toFixed(1)}`}
          />
        </div>
      )}

      <Tabs defaultValue="moves" className="mt-8">
        <TabsList>
          <TabsTrigger value="moves">Moves</TabsTrigger>
          <TabsTrigger value="lineup">Lineup</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="scoreboard">Scoreboard</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="waivers">Available</TabsTrigger>
          <TabsTrigger value="trade">Trade</TabsTrigger>
        </TabsList>

        <TabsContent value="moves" className="mt-6 space-y-3">
          {!data.suggestions.length && (
            <p className="text-sm text-muted-foreground">
              No moves worth making right now — your lineup is already the strongest one available.
            </p>
          )}
          {data.suggestions.map((s) => (
            <article key={s.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Badge variant="secondary" className="uppercase">
                    {s.kind.replace(/_/g, " ")}
                  </Badge>
                  <h3 className="mt-2 text-xl font-semibold">{s.headline}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
                </div>
                <div className="text-right">
                  <p className="eyebrow text-muted-foreground">Title odds</p>
                  <p
                    className={`stat-num text-2xl ${s.titleDelta >= 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {signed(s.titleDelta)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Playoffs {signed(s.playoffDelta)} · {s.pointsDelta >= 0 ? "+" : ""}
                    {s.pointsDelta.toFixed(1)} proj pts
                  </p>
                </div>
              </div>
            </article>
          ))}
        </TabsContent>

        <TabsContent value="lineup" className="mt-6 grid gap-6 md:grid-cols-2">
          <PlayerList title="Best starting lineup" players={data.lineup} />
          <PlayerList title="Bench" players={data.bench} />
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
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Team</th>
                <th className="py-2">Record</th>
                <th className="py-2">Points</th>
                <th className="py-2">Playoffs</th>
                <th className="py-2">Title</th>
              </tr>
            </thead>
            <tbody>
              {data.standings.map((t) => (
                <tr
                  key={t.id}
                  className={`border-t border-border ${t.isMine ? "bg-primary/5 font-semibold" : ""}`}
                >
                  <td className="py-3">{t.name}</td>
                  <td className="stat-num py-3">{t.record}</td>
                  <td className="stat-num py-3">{t.pointsFor.toFixed(1)}</td>
                  <td className="stat-num py-3">{pct(t.playoffOdds)}</td>
                  <td className="stat-num py-3 text-primary">{pct(t.titleOdds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>

        <TabsContent value="waivers" className="mt-6">
          <WaiverPanel leagueId={leagueId} />
        </TabsContent>

        <TabsContent value="trade" className="mt-6">
          <TradePanel leagueId={leagueId} />
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
  players: { name: string; position: string; slot?: string; proj: number }[];
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-bold uppercase">{title}</h2>
      <ul className="mt-3 space-y-2">
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between text-sm">
            <span>
              <span className="eyebrow mr-2 text-muted-foreground">{p.slot ?? p.position}</span>
              {p.name}
            </span>
            <span className="stat-num">{p.proj.toFixed(1)}</span>
          </li>
        ))}
        {!players.length && <li className="text-sm text-muted-foreground">Nothing here.</li>}
      </ul>
    </section>
  );
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

function WaiverPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getWaiverWire);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");

  const { data, isFetching } = useQuery({
    queryKey: ["waivers", leagueId, search, position],
    queryFn: () => load({ data: { leagueId, search, position } }),
    refetchOnWindowFocus: false,
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold uppercase">Available players</h2>
          <p className="text-xs text-muted-foreground">
            Everyone not already on a roster in this league.
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

      {!!data?.estimatedRosterSpots && (
        <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Some rival rosters are estimated because this league was added by hand. Enter or import
          their real rosters to make this list exact.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {isFetching && !data && <li className="text-sm text-muted-foreground">Loading…</li>}
        {data?.players.map((p) => (
          <li key={p.id} className="flex items-center justify-between border-t border-border py-2 text-sm">
            <span>
              <span className="eyebrow mr-2 text-muted-foreground">{p.position}</span>
              {p.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {p.nflTeam ?? "FA"}
                {p.byeWeek ? ` · bye ${p.byeWeek}` : ""}
                {p.status && p.status !== "Active" ? ` · ${p.status}` : ""}
              </span>
            </span>
            <span className="stat-num">{p.proj.toFixed(1)}</span>
          </li>
        ))}
        {data && !data.players.length && (
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
            <Button asChild size="sm" variant="ghost">
              <Link to="/trades">See trade history</Link>
            </Button>
          </div>
        </div>
      )}
    </section>
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
