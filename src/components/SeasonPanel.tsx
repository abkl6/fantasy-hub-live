import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSeasonScenarioFn } from "@/lib/fantasy.functions";
import type { SeasonOutcome, SeasonPayload } from "@/lib/fantasy/season-types";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const FINISH_ROWS = [
  { key: "champion", label: "Wins it all", className: "bg-primary" },
  { key: "final", label: "Loses the final", className: "bg-primary/70" },
  { key: "semifinal", label: "Out in the semi-final", className: "bg-primary/45" },
  { key: "bye", label: "Out after the first-round bye", className: "bg-primary/30" },
  { key: "wildCard", label: "Out in the first round", className: "bg-primary/20" },
  { key: "missed", label: "Misses the playoffs", className: "bg-muted" },
] as const;

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-card p-5">
      <h3 className="text-sm font-bold">{title}</h3>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FinishBar({ outcome }: { outcome: SeasonOutcome }) {
  const rows = FINISH_ROWS.map((r) => ({ ...r, share: outcome.finish[r.key] ?? 0 })).filter(
    (r) => r.share > 0.0005,
  );
  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {rows.map((r) => (
          <div
            key={r.key}
            className={r.className}
            style={{ width: `${Math.max(0.5, r.share * 100)}%` }}
            title={`${r.label}: ${pct(r.share)}`}
          />
        ))}
      </div>
      <p className="text-sm">
        <span className="font-display text-2xl font-bold text-primary tabular-nums">
          {pct(outcome.finish.champion)}
        </span>{" "}
        <span className="text-muted-foreground">wins the title</span>
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span className={`size-3 shrink-0 rounded-sm ${r.className}`} aria-hidden="true" />
            <span className="flex-1 truncate text-muted-foreground">{r.label}</span>
            <span className="tabular-nums">{pct(r.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WinHistogram({
  outcome,
  currentWins,
  playoffCut,
}: {
  outcome: SeasonOutcome;
  currentWins: number;
  playoffCut: number | null;
}) {
  const bars = outcome.winSpread;
  const peak = Math.max(0.01, ...bars.map((b) => b.share));
  const projected = Math.round(outcome.projWins);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1" style={{ height: 130 }}>
        {bars.map((b) => {
          const isProjected = b.wins === projected;
          const madeCut = playoffCut !== null && b.wins >= Math.round(playoffCut);
          return (
            <div key={b.wins} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {b.share >= 0.05 ? pct(b.share) : ""}
              </span>
              <div
                className={`w-full rounded-t ${isProjected ? "bg-primary" : madeCut ? "bg-primary/45" : "bg-muted"}`}
                style={{ height: `${Math.max(3, (b.share / peak) * 92)}%` }}
                title={`${b.wins} wins: ${pct(b.share)}`}
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">{b.wins}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Wins across the whole season. You have {currentWins} so far and finish on{" "}
        <span className="font-semibold text-foreground">{outcome.projWins.toFixed(1)}</span> on
        average.
        {playoffCut !== null
          ? ` Teams usually need about ${playoffCut.toFixed(1)} wins to make the playoffs.`
          : ""}
      </p>
    </div>
  );
}

function OddsTrail({ history }: { history: SeasonPayload["history"] }) {
  if (!history.length)
    return <p className="text-sm text-muted-foreground">No weeks recorded yet — this builds up as the season runs.</p>;
  const peak = Math.max(0.05, ...history.map((h) => h.playoffOdds));
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2" style={{ height: 140 }}>
        {history.map((h) => (
          <div key={h.week} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div className="flex w-full items-end justify-center gap-0.5" style={{ height: "100%" }}>
              <div
                className="w-2 rounded-t bg-primary/40"
                style={{ height: `${Math.max(2, (h.playoffOdds / peak) * 100)}%` }}
                title={`Week ${h.week}: ${pct(h.playoffOdds)} playoffs`}
              />
              <div
                className="w-2 rounded-t bg-primary"
                style={{ height: `${Math.max(2, (h.titleOdds / peak) * 100)}%` }}
                title={`Week ${h.week}: ${pct(h.titleOdds)} title`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{h.week}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-primary/40" aria-hidden="true" /> Playoffs
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-primary" aria-hidden="true" /> Title
        </span>
      </div>
      <ul className="space-y-1">
        {history
          .filter((h) => h.markers.length)
          .map((h) => (
            <li key={h.week} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Week {h.week}</span> ·{" "}
              {h.markers.map((m) => m.label).join(" · ")} · playoffs {pct(h.playoffOdds)}, title{" "}
              {pct(h.titleOdds)}
            </li>
          ))}
      </ul>
    </div>
  );
}

export function SeasonPanel({ leagueId, season }: { leagueId: string; season: SeasonPayload }) {
  const [picks, setPicks] = useState<Record<number, boolean>>({});
  const run = useServerFn(getSeasonScenarioFn);
  const forced = useMemo(
    () =>
      Object.entries(picks)
        .map(([week, win]) => ({ week: Number(week), win }))
        .sort((a, b) => a.week - b.week),
    [picks],
  );

  const scenario = useQuery({
    queryKey: ["season-scenario", leagueId, forced],
    queryFn: () => run({ data: { leagueId, forced } }),
    enabled: forced.length > 0,
  });

  const outcome = (forced.length && scenario.data ? scenario.data : season.outcome) as SeasonOutcome;
  const busy = forced.length > 0 && scenario.isFetching;

  const toggle = (week: number, win: boolean) =>
    setPicks((prev) => {
      const next = { ...prev };
      if (next[week] === win) delete next[week];
      else next[week] = win;
      return next;
    });

  return (
    <div className="space-y-4">
      {forced.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs">
          <span className="font-semibold">
            Showing {season.myTeamName} with {forced.length} game{forced.length === 1 ? "" : "s"}{" "}
            decided by you.
          </span>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicks({})}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Back to the real forecast
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How the season ends"
          note={`Out of ${outcome.iterations.toLocaleString()} run-throughs of the rest of the year.`}
        >
          <FinishBar outcome={outcome} />
        </Panel>

        <Panel title="Where your record lands" note={`You are ${season.currentRecord} right now.`}>
          <WinHistogram
            outcome={outcome}
            currentWins={season.currentWins}
            playoffCut={season.playoffCut}
          />
        </Panel>

        <Panel title="Your chances week by week" note="What has moved them along the way.">
          <OddsTrail history={season.history} />
        </Panel>

        <Panel
          title="Games left"
          note="Tap W or L to decide a game and watch the two panels above change."
        >
          {!season.remaining.length ? (
            <p className="text-sm text-muted-foreground">No games left on the schedule.</p>
          ) : (
            <ul className="space-y-2">
              {season.remaining.map((g) => (
                <li key={g.week} className="flex items-center gap-3 rounded-lg bg-background p-2">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">Wk {g.week}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{g.opponentName}</span>
                  <Badge variant="secondary" className="tabular-nums">
                    {pct(g.winProb)}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={picks[g.week] === true ? "default" : "outline"}
                      onClick={() => toggle(g.week, true)}
                      aria-pressed={picks[g.week] === true}
                    >
                      W
                    </Button>
                    <Button
                      size="sm"
                      variant={picks[g.week] === false ? "default" : "outline"}
                      onClick={() => toggle(g.week, false)}
                      aria-pressed={picks[g.week] === false}
                    >
                      L
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {outcome.seedSpread.length ? (
          <Panel title="Where you finish in the standings" note="Your chance of each playoff place.">
            <ul className="grid gap-1 sm:grid-cols-2">
              {outcome.seedSpread.map((s) => (
                <li key={s.seed} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-muted-foreground">Place {s.seed}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, s.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-12 text-right tabular-nums">{pct(s.share)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
