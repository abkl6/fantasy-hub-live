import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteTrade, listTradeHistory, updateTradeStatus } from "@/lib/platforms.functions";

export const Route = createFileRoute("/_authenticated/trades")({
  head: () => ({
    meta: [
      { title: "Trade history — Gridiron Edge" },
      {
        name: "description",
        content:
          "Every trade you have logged, with the championship and playoff odds before and after each one, so you can see which deals actually moved the needle.",
      },
      { property: "og:title", content: "Trade history — Gridiron Edge" },
      {
        property: "og:description",
        content: "Track each trade and how it changed your title odds over the season.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TradesPage,
});

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function TradesPage() {
  const list = useServerFn(listTradeHistory);
  const setStatus = useServerFn(updateTradeStatus);
  const remove = useServerFn(deleteTrade);
  const queryClient = useQueryClient();

  const trades = useQuery({
    queryKey: ["trade-history"],
    queryFn: () => list({ data: {} }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["trade-history"] });

  const status = useMutation({
    mutationFn: (vars: { id: string; status: "proposed" | "accepted" | "declined" }) =>
      setStatus({ data: vars }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update that trade."),
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Trade removed.");
      void invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove that trade."),
  });

  const rows = trades.data ?? [];
  const accepted = rows.filter((t) => t.status === "accepted");
  const netTitle = accepted.reduce((sum, t) => sum + (t.titleOddsAfter - t.titleOddsBefore), 0);
  const netPlayoff = accepted.reduce((sum, t) => sum + (t.playoffOddsAfter - t.playoffOddsBefore), 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold uppercase">Trade history</h1>

      {accepted.length > 0 && (
        <div className="mt-6 inline-flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-5 py-4">
          <span className="eyebrow text-muted-foreground">Net odds from accepted trades</span>
          <span className="flex items-baseline gap-2">
            <span className="eyebrow text-muted-foreground">Title</span>
            <span
              className={`stat-num text-2xl font-bold ${netTitle >= 0 ? "text-primary" : "text-destructive"}`}
            >
              {netTitle >= 0 ? "+" : ""}
              {(netTitle * 100).toFixed(1)}%
            </span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="eyebrow text-muted-foreground">Playoff</span>
            <span
              className={`stat-num text-2xl font-bold ${netPlayoff >= 0 ? "text-primary" : "text-destructive"}`}
            >
              {netPlayoff >= 0 ? "+" : ""}
              {(netPlayoff * 100).toFixed(1)}%
            </span>
          </span>
        </div>
      )}

      {trades.isLoading && (
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading your trades…
        </p>
      )}

      {!trades.isLoading && !rows.length && (
        <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No trades logged yet. Build one in a league's Trade tab and save it here.
          </p>
          <Button asChild className="mt-4">
            <Link to="/manager-hub">Go to my leagues</Link>
          </Button>
        </div>
      )}

      <div className="mt-8 space-y-4">
        {rows.map((t) => {
          const titleDelta = t.titleOddsAfter - t.titleOddsBefore;
          const playoffDelta = t.playoffOddsAfter - t.playoffOddsBefore;
          const up = titleDelta >= 0;
          return (
            <article key={t.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow text-muted-foreground">
                    {t.leagueName} · Week {t.week}
                    {t.partnerTeamName ? ` · with ${t.partnerTeamName}` : ""}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Out:</span>
                    <span className="font-semibold">
                      {t.gave.map((p) => p.name).join(", ") || "—"}
                    </span>
                    <ArrowRight className="size-4 text-primary" aria-hidden="true" />
                    <span className="text-muted-foreground">In:</span>
                    <span className="font-semibold">{t.got.map((p) => p.name).join(", ") || "—"}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`stat-num flex items-center justify-end gap-1 text-2xl font-bold ${up ? "text-primary" : "text-destructive"}`}
                  >
                    {up ? (
                      <TrendingUp className="size-5" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="size-5" aria-hidden="true" />
                    )}
                    {up ? "+" : ""}
                    {(titleDelta * 100).toFixed(1)}%
                  </p>
                  <p className="eyebrow text-muted-foreground">title odds</p>
                  <p
                    className={`stat-num mt-1 text-sm font-semibold ${playoffDelta >= 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {playoffDelta >= 0 ? "+" : ""}
                    {(playoffDelta * 100).toFixed(1)}%
                  </p>
                  <p className="eyebrow text-muted-foreground">playoff odds</p>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="eyebrow text-muted-foreground">Title odds</dt>
                  <dd className="stat-num">
                    {pct(t.titleOddsBefore)} → {pct(t.titleOddsAfter)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Playoff odds</dt>
                  <dd className="stat-num">
                    {pct(t.playoffOddsBefore)} → {pct(t.playoffOddsAfter)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Projected wins</dt>
                  <dd className="stat-num">
                    {t.winsBefore.toFixed(1)} → {t.winsAfter.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Weekly points</dt>
                  <dd className="stat-num">
                    {t.pointsDelta >= 0 ? "+" : ""}
                    {t.pointsDelta.toFixed(1)}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge
                  variant={t.status === "accepted" ? "default" : "outline"}
                  className={t.status === "declined" ? "border-muted text-muted-foreground" : ""}
                >
                  {t.status}
                </Badge>
                {t.status !== "accepted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={status.isPending}
                    onClick={() => status.mutate({ id: t.id, status: "accepted" })}
                  >
                    Mark as made
                  </Button>
                )}
                {t.status !== "declined" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={status.isPending}
                    onClick={() => status.mutate({ id: t.id, status: "declined" })}
                  >
                    Mark as declined
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <Link to="/league/$leagueId" params={{ leagueId: t.leagueId }}>
                    Open league
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove this trade"
                  disabled={del.isPending}
                  onClick={() => del.mutate(t.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
